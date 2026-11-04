#!/usr/bin/env bash
# Fetch a vendored Node runtime for the packaged desktop shell.
# Usage: ./vendor-node.sh [version]  (default: 22.12.0 to match CI)
set -euo pipefail

VERSION="${1:-22.12.0}"
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Darwin-arm64) TRIPLE="darwin-arm64" ;;
  Darwin-x86_64) TRIPLE="darwin-x64" ;;
  Linux-x86_64) TRIPLE="linux-x64" ;;
  *) echo "unsupported packaging host: $OS-$ARCH" >&2; exit 1 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HERE/vendor/node"
rm -rf "$DEST"
mkdir -p "$HERE/vendor"
curl -fsSL "https://nodejs.org/dist/v${VERSION}/node-v${VERSION}-${TRIPLE}.tar.gz" \
  | tar -xz -C "$HERE/vendor"
mv "$HERE/vendor/node-v${VERSION}-${TRIPLE}" "$DEST"
"$DEST/bin/node" --version
echo "vendored node in $DEST"
