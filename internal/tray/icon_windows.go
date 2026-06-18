package tray

import _ "embed"

// Windows systray requires ICO format.
//
//go:embed icon.ico
var icon []byte
