# TubeRemote

Control YouTube playing on your PC from your phone, over your local network. No
cloud, no account, no third-party server — a small Go binary runs on your PC and
your phone talks to it directly over Wi‑Fi.

## How it works

TubeRemote has three pieces that talk over a single local WebSocket relay:

```
  Phone (remote)  ──WS──►  Go binary (PC)  ◄──WS──  Chrome extension
   React web app           localhost:7331           controls the YouTube tab
```

- **Go binary** — runs on the PC. Serves the phone's web UI (embedded), relays
  messages between the phone and the extension, and fetches comments / video
  info server-side via YouTube's own data. Mints a random auth token on each
  start.
- **Chrome extension** (MV3) — connects to the binary and drives the YouTube tab:
  play/pause, seek, volume, quality, fullscreen, search, home feed. It reports
  player state back as events.
- **Phone web app** — opened by scanning the QR code from the extension popup.
  Sends commands and renders live player state, search results, comments, etc.

Messages are **event-driven**: the remote sends `COMMAND`s, the extension emits
`EVENT`s (player state, search/home results, quality). The seek bar interpolates
locally and is corrected by a position resync that runs **only while playing**.

## Features

- ▶️ Transport controls — play/pause, seek, volume, mute, next/previous
- 🔍 Search YouTube and play results from your phone
- 🏠 Browse the home feed
- 💬 Read the video description and comments (fetched server-side, paginated)
- 🎚️ Read/set playback quality
- ⛶ Toggle fullscreen
- 🔌 Resilient connection — auto-reconnect that survives the binary restarting
  and Chrome suspending the extension's service worker

## Requirements

- A PC running the binary (Windows / macOS / Linux)
- Google Chrome with the TubeRemote extension loaded
- A phone on the **same local network** as the PC
- For building from source: [Go](https://go.dev/) 1.21+ and
  [Bun](https://bun.sh/) (for the web build)

## Build

The web UI is built and embedded into the Go binary via `go:embed`, so a build
always bundles the latest UI.

```sh
make build       # builds web + binary into bin/tuberemote
make build-all   # cross-compiles Windows / macOS (arm64) / Linux
make run         # build web, then `go run .`
```

Or manually:

```sh
cd web && bun install && bun run build && cd ..
go build -o bin/tuberemote .
```

## Install the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` folder

> After changing `extension/manifest.json` (e.g. permissions), reload the
> extension from `chrome://extensions`.

## Usage

1. Run the binary on your PC:
   ```sh
   ./bin/tuberemote
   ```
   It prints the local URL and token, and listens on port **7331**.
2. Open a `youtube.com` tab in Chrome.
3. Click the TubeRemote extension icon — the popup shows a **QR code**.
4. Scan the QR with your phone (same Wi‑Fi). The remote UI opens and pairs.

When the popup shows "Phone connected" and the phone shows "Connected", you're
good to go.

## Connection & auth notes

- The binary mints a **new random token every start**, embedded in the QR URL.
  If you restart the binary, the old QR link expires: the phone shows an
  **"expired link — rescan the QR"** screen. Just scan the fresh QR again.
- The Chrome extension auto-recovers without a rescan — it runs on the same
  machine as the binary and refreshes the token itself.
- The extension uses a `chrome.alarms` heartbeat so it reconnects within ~30s
  even after Chrome suspends its MV3 service worker (otherwise a dropped
  connection could leave the phone stuck on "Waiting…").
- Auth is a shared token over the LAN — it's a pairing gate for a trusted home
  network, not a hardened security boundary. Don't expose port 7331 to the
  public internet.

## HTTP/WS endpoints

Served by the binary on `:7331`:

| Path            | Purpose                                            |
| --------------- | -------------------------------------------------- |
| `/`             | Phone web app (embedded)                           |
| `/ws`           | WebSocket relay (handshake: `deviceType` + `token`)|
| `/api/qr`       | QR PNG encoding the remote URL + token             |
| `/api/status`   | Connection status + current token                  |
| `/api/comments` | Video comments (`?v=` first page, `?continuation=`)|
| `/api/video`    | Video description / author / views (`?v=`)          |

## Project structure

```
main.go                  # entry point: token, embed web/dist, start server
internal/server/         # WebSocket relay + REST endpoints
internal/network/        # local IP detection (prefers LAN over VPN/Tailscale)
internal/qr/             # QR code generation
internal/youtube/        # server-side comments / video info fetching
extension/               # Chrome MV3 extension (background, content script, popup)
web/                     # React + Vite phone UI (built into web/dist, embedded)
```

## License

Personal project — use at your own discretion.
