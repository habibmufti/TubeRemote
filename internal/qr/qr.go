package qr

import (
	qrcode "github.com/skip2/go-qrcode"
)

// PNG returns a QR code PNG for the given content at the given size.
func PNG(content string, size int) ([]byte, error) {
	return qrcode.Encode(content, qrcode.Medium, size)
}
