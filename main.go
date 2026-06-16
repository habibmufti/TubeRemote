package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"log"
	"net/http"

	"github.com/tuberemote/internal/network"
	"github.com/tuberemote/internal/server"
)

//go:embed all:web/dist
var webFiles embed.FS

const port = 7331

func main() {
	token := randomToken()
	localIP := network.LocalIP()

	webDist, err := fs.Sub(webFiles, "web/dist")
	if err != nil {
		log.Fatal("embed error:", err)
	}

	srv := server.New(token, localIP, port, webDist)

	addr := fmt.Sprintf("0.0.0.0:%d", port)
	fmt.Printf("\n  TubeRemote running\n")
	fmt.Printf("  Local:   http://localhost:%d\n", port)
	fmt.Printf("  Network: http://%s:%d\n", localIP, port)
	fmt.Printf("  Token:   %s\n\n", token)
	fmt.Printf("  Open Chrome extension popup to get QR code\n\n")

	log.Fatal(http.ListenAndServe(addr, srv.Handler()))
}

func randomToken() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}
