#!/usr/bin/env bash
# Create the project-local Python venv and install the OpenCV/WeChat decoders
# used by the scannability suite's "real platform" layer. Idempotent.
#
# Everything is installed into ./.venv — never onto the host interpreter.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d .venv ]; then
  echo "Creating .venv ..."
  python3 -m venv .venv
fi

echo "Installing decoder dependencies into .venv ..."
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -r tools/decoders/requirements.txt

echo "Done. Verifying:"
.venv/bin/python -c "import cv2; print('  cv2', cv2.__version__)"
echo "Run the gated suite with:  npm run test:decoders:py"
