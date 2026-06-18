.PHONY: build build-all release snapshot web clean run

BIN_DIR := bin
WEB_DIR := web

web:
	cd $(WEB_DIR) && bun install && bun run build

build: web
	go build -ldflags "-X main.version=dev" -o $(BIN_DIR)/tuberemote .

build-all: web
	GOOS=windows GOARCH=amd64 go build -ldflags "-H windowsgui -X main.version=dev" -o $(BIN_DIR)/tuberemote-windows.exe .
	GOOS=darwin  GOARCH=arm64 go build -ldflags "-X main.version=dev" -o $(BIN_DIR)/tuberemote-macos .
	GOOS=linux   GOARCH=amd64 go build -ldflags "-X main.version=dev" -o $(BIN_DIR)/tuberemote-linux .

# Create a full release (requires GITHUB_TOKEN, push a tag first: git tag v1.0.0 && git push --tags)
release:
	goreleaser release --clean

# Local test build without publishing
snapshot:
	goreleaser release --snapshot --clean

run: web
	go run -ldflags "-X main.version=dev" .

clean:
	rm -rf $(BIN_DIR) $(WEB_DIR)/dist $(WEB_DIR)/node_modules dist/
