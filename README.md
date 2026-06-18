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
- 🖥️ Runs in the **system tray** — no terminal window; right-click to open the
  web UI or quit
- ⬆️ **Auto-update** — checks GitHub for new releases on startup and updates
  itself in place with `--update`

## Requirements

- A PC running the app (Windows / macOS / Linux)
- Google Chrome with the TubeRemote extension loaded
- A phone on the **same local network** as the PC
- On Linux, a desktop environment with a system-tray / app-indicator
- For building from source: [Go](https://go.dev/) 1.21+ and
  [Bun](https://bun.sh/) (for the web build)

## Download & install

Grab the latest [**release**](https://github.com/habibmufti/TubeRemote/releases/latest).
You need **two** things: the app for your PC, and the Chrome extension.

### 1. The PC app

Pick the **installer** for your platform (recommended), or grab the raw binary
if you'd rather not install:

| Platform              | Installer                       | Raw binary                     |
| --------------------- | ------------------------------- | ------------------------------ |
| Windows               | `tuberemote-windows-setup.exe`  | `tuberemote-windows-amd64.exe` |
| macOS (Apple Silicon) | `tuberemote-macos-arm64.pkg`    | `tuberemote-macos-arm64`       |
| macOS (Intel)         | `tuberemote-macos-amd64.pkg`    | `tuberemote-macos-amd64`       |
| Linux (Debian/Ubuntu) | `tuberemote-linux-amd64.deb`    | `tuberemote-linux-amd64`       |
| Linux (Fedora/RHEL)   | `tuberemote-linux-amd64.rpm`    |                                |

- **Windows** — run `tuberemote-windows-setup.exe`. If SmartScreen warns, choose
  *More info → Run anyway* (the installer is unsigned). It installs to Program
  Files, adds a Start Menu shortcut, and puts `tuberemote` on your PATH.
- **macOS** — open the `.pkg` and follow the prompts (installs to
  `/usr/local/bin`). First run may need *System Settings → Privacy & Security →
  Open Anyway* (unsigned).
- **Linux** — `sudo dpkg -i tuberemote-linux-amd64.deb` (or
  `sudo rpm -i tuberemote-linux-amd64.rpm`). Or run the raw binary after
  `chmod +x`.

Once launched, TubeRemote **runs in the system tray** and listens on port
**7331** — there's no terminal window on Windows. Right-click the tray icon to
**Open in Browser** or **Quit**. (Run a raw binary from a terminal on
macOS/Linux and it also prints the local URL and token.)

#### Updating

TubeRemote checks GitHub for a newer release on startup and tells you if one is
available. To update in place:

```sh
tuberemote --update     # download and install the latest release
tuberemote --version    # print the current version
```

### 2. The Chrome extension

1. Download `tuberemote-extension.zip` from the release and **unzip** it.
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the unzipped `tuberemote-extension` folder

> Verify a download with `sha256sum -c SHA256SUMS.txt` (or `shasum -a 256`).

Then jump to [Usage](#usage). To build from source instead, read on.

## Build from source

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

1. Launch TubeRemote on your PC (Start Menu / Launchpad, or run the binary). It
   appears in the **system tray** and listens on port **7331**.
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
main.go                  # entry point: token, embed web/dist, start server + tray
internal/server/         # WebSocket relay + REST endpoints
internal/network/        # local IP detection (default-route LAN, skips virtual adapters)
internal/qr/             # QR code generation
internal/youtube/        # server-side comments / video info fetching
internal/tray/           # system-tray icon (open in browser / quit)
internal/updater/        # GitHub release check + in-place self-update
extension/               # Chrome MV3 extension (background, content script, popup)
web/                     # React + Vite phone UI (built into web/dist, embedded)
```

## License

Personal project — use at your own discretion.
