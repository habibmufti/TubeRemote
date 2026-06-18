//go:build !windows

package tray

import _ "embed"

// macOS and Linux systray use PNG format.
//
//go:embed icon.png
var icon []byte
