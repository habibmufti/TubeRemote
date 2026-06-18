package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/tuberemote/internal/network"
	"github.com/tuberemote/internal/server"
	"github.com/tuberemote/internal/tray"
	"github.com/tuberemote/internal/updater"
)

//go:embed all:web/dist
var webFiles embed.FS

var version = "dev"

const port = 7331

func main() {
	doUpdate := flag.Bool("update", false, "download and install the latest release")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("tuberemote %s\n", version)
		os.Exit(0)
	}

	if *doUpdate {
		if err := updater.Apply(version); err != nil {
			log.Fatalf("update failed: %v", err)
		}
		os.Exit(0)
	}

	token := randomToken()
	localIP := network.LocalIP()

	webDist, err := fs.Sub(webFiles, "web/dist")
	if err != nil {
		log.Fatal("embed error:", err)
	}

	srv := server.New(token, localIP, port, webDist)

	go func() {
		addr := fmt.Sprintf("0.0.0.0:%d", port)
		log.Fatal(http.ListenAndServe(addr, srv.Handler()))
	}()

	updater.CheckAndNotify(version)

	fmt.Printf("\n  TubeRemote %s\n", version)
	fmt.Printf("  Local:   http://localhost:%d\n", port)
	fmt.Printf("  Network: http://%s:%d\n", localIP, port)
	fmt.Printf("  Token:   %s\n\n", token)

	tray.Run(tray.Config{
		Version: version,
		Port:    port,
		Token:   token,
		OnQuit:  func() { os.Exit(0) },
	})
}

func randomToken() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}
