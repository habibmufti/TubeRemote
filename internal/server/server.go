package server

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/tuberemote/internal/qr"
	"github.com/tuberemote/internal/youtube"
)

const (
	pingInterval = 25 * time.Second
	pongWait     = 35 * time.Second
	writeWait    = 5 * time.Second
)

type Message struct {
	Type    string          `json:"type"`
	Action  string          `json:"action,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type Handshake struct {
	DeviceType string `json:"deviceType"`
	Token      string `json:"token"`
}

type client struct {
	conn       *websocket.Conn
	deviceType string
	send       chan []byte
}

type Server struct {
	token     string
	localIP   string
	port      int
	webFS     fs.FS
	upgrader  websocket.Upgrader
	mu        sync.RWMutex
	extension *client
	remote    *client
}

func New(token, localIP string, port int, webFS fs.FS) *Server {
	return &Server{
		token:   token,
		localIP: localIP,
		port:    port,
		webFS:   webFS,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWS)
	mux.HandleFunc("/api/qr", s.handleQR)
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/comments", s.handleComments)
	mux.Handle("/", http.FileServer(http.FS(s.webFS)))
	return mux
}

func (s *Server) handleQR(w http.ResponseWriter, r *http.Request) {
	url := fmt.Sprintf("http://%s:%d/?token=%s", s.localIP, s.port, s.token)
	png, err := qr.PNG(url, 256)
	if err != nil {
		http.Error(w, "qr error", 500)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(png)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	extConnected := s.extension != nil
	remConnected := s.remote != nil
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(map[string]any{
		"extensionConnected": extConnected,
		"remoteConnected":    remConnected,
		"token":              s.token,
	})
}

func (s *Server) handleComments(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	if r.URL.Query().Get("token") != s.token {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]any{"comments": []any{}, "error": "unauthorized"})
		return
	}
	videoID := r.URL.Query().Get("v")
	if videoID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"comments": []any{}, "error": "missing video id"})
		return
	}

	comments, err := youtube.FetchComments(videoID, 40)
	if err != nil {
		log.Println("comments fetch error:", err)
		json.NewEncoder(w).Encode(map[string]any{"comments": []any{}, "error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"comments": comments})
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("ws upgrade error:", err)
		return
	}

	// First message must be handshake
	_, raw, err := conn.ReadMessage()
	if err != nil {
		conn.Close()
		return
	}

	var hs Handshake
	if err := json.Unmarshal(raw, &hs); err != nil || hs.Token != s.token {
		conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ERROR","message":"invalid token"}`))
		conn.Close()
		return
	}

	if hs.DeviceType != "extension" && hs.DeviceType != "remote" {
		conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ERROR","message":"unknown deviceType"}`))
		conn.Close()
		return
	}

	c := &client{conn: conn, deviceType: hs.DeviceType, send: make(chan []byte, 64)}

	s.mu.Lock()
	var peerAlreadyConnected bool
	switch hs.DeviceType {
	case "extension":
		if s.extension != nil {
			s.extension.conn.Close()
		}
		s.extension = c
		peerAlreadyConnected = s.remote != nil
	case "remote":
		if s.remote != nil {
			s.remote.conn.Close()
		}
		s.remote = c
		peerAlreadyConnected = s.extension != nil
	}
	s.mu.Unlock()

	log.Printf("[ws] %s connected", hs.DeviceType)
	s.notifyPeer(c, `{"type":"PEER_CONNECTED"}`) // tell peer that we joined
	if peerAlreadyConnected {
		// tell ourselves that peer is already connected
		c.send <- []byte(`{"type":"PEER_CONNECTED"}`)
	}

	go c.writePump()
	s.readPump(c)

	s.mu.Lock()
	switch c.deviceType {
	case "extension":
		if s.extension == c {
			s.extension = nil
		}
	case "remote":
		if s.remote == c {
			s.remote = nil
		}
	}
	s.mu.Unlock()
	close(c.send)

	log.Printf("[ws] %s disconnected", c.deviceType)
	s.notifyPeer(c, `{"type":"PEER_DISCONNECTED"}`)
}

func (s *Server) readPump(c *client) {
	defer c.conn.Close()
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		s.route(c, raw)
	}
}

func (c *client) writePump() {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (s *Server) route(from *client, raw []byte) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	switch from.deviceType {
	case "remote":
		// COMMAND: remote → extension
		if s.extension != nil {
			select {
			case s.extension.send <- raw:
			default:
			}
		}
	case "extension":
		// EVENT: extension → remote
		if s.remote != nil {
			select {
			case s.remote.send <- raw:
			default:
			}
		}
	}
}

func (s *Server) notifyPeer(from *client, msg string) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var peer *client
	switch from.deviceType {
	case "extension":
		peer = s.remote
	case "remote":
		peer = s.extension
	}
	if peer == nil {
		return
	}
	select {
	case peer.send <- []byte(msg):
	default:
	}
}
