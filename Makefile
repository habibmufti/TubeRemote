.PHONY: build build-all web clean run

BIN_DIR := bin
WEB_DIR := web

web:
	cd $(WEB_DIR) && bun install && bun run build

build: web
	go build -o $(BIN_DIR)/tuberemote .

build-all: web
	GOOS=windows GOARCH=amd64 go build -o $(BIN_DIR)/tuberemote-windows.exe .
	GOOS=darwin  GOARCH=arm64 go build -o $(BIN_DIR)/tuberemote-macos .
	GOOS=linux   GOARCH=amd64 go build -o $(BIN_DIR)/tuberemote-linux .

run: web
	go run .

clean:
	rm -rf $(BIN_DIR) $(WEB_DIR)/dist $(WEB_DIR)/node_modules
