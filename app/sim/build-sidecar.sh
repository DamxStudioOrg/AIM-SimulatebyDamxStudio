#!/usr/bin/env bash
# Build the desktop sim sidecar: a single-file aim-sim-server binary.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$(dirname "$HERE")")"
PY="$ROOT/.venv/bin/python"

"$PY" -c "import PyInstaller" 2>/dev/null || "$PY" -m pip install -q pyinstaller
"$PY" -c "import fastapi, uvicorn" 2>/dev/null || "$PY" -m pip install -q -e "$HERE/.[api]"

cd "$HERE"
"$PY" -m PyInstaller --noconfirm --clean --onefile \
  --name aim-sim-server \
  --distpath dist \
  --workpath build/sidecar \
  sidecar.py >/tmp/aim-sidecar-build.log 2>&1
echo "built sim/dist/aim-sim-server ($(du -h dist/aim-sim-server | cut -f1))"
