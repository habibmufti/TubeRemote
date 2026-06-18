#!/usr/bin/env bash
# Usage: build-pkg.sh <binary> <version> <arch> <output>
# Example: build-pkg.sh ./tuberemote 1.2.0 arm64 tuberemote-macos-arm64.pkg
set -euo pipefail

BINARY="$1"
VERSION="$2"
ARCH="$3"
OUTPUT="$4"

PAYLOAD=$(mktemp -d)
mkdir -p "$PAYLOAD/usr/local/bin"
cp "$BINARY" "$PAYLOAD/usr/local/bin/tuberemote"
chmod 755 "$PAYLOAD/usr/local/bin/tuberemote"

pkgbuild \
    --root "$PAYLOAD" \
    --identifier com.habibmufti.tuberemote \
    --version "$VERSION" \
    --install-location / \
    "$OUTPUT"

rm -rf "$PAYLOAD"
echo "Built: $OUTPUT"
