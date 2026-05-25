#!/usr/bin/env python3
"""Batch QR decoder for the scannability suite's "real platform" layer.

Reads a JSON manifest of images and decodes each with two OpenCV-family
detectors that represent decoder lineages the JS/wasm engines don't cover:

  - cv2.QRCodeDetector   — OpenCV's classic geometric detector, embedded in a
                           great many desktop/CV pipelines.
  - cv2.wechat_qrcode    — the CNN-based detector WeChat ships (a billion-user
                           platform). Constructed with no model paths so it runs
                           purely offline via its built-in fallback detection —
                           no network, no model download.

Usage:
    python decode_qr.py MANIFEST.json

MANIFEST.json is a JSON array of {"path": "<abs png path>", "expect": "<text>"}.
Prints a JSON array to stdout, one object per manifest entry:
    {"path", "expect", "qrcode_detector": <str|null>, "wechat": <str|null>}
A null means that detector failed to read the image. Per-image errors are
caught and reported as null so one bad frame never aborts the batch.
"""
import json
import sys

import cv2


def decode_classic(detector, img):
    try:
        text, points, _ = detector.detectAndDecode(img)
        return text if text else None
    except cv2.error:
        return None


def decode_wechat(detector, img):
    try:
        texts, _ = detector.detectAndDecode(img)
        for t in texts:
            if t:
                return t
        return None
    except cv2.error:
        return None


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: decode_qr.py MANIFEST.json", file=sys.stderr)
        return 2
    with open(sys.argv[1], encoding="utf-8") as fh:
        manifest = json.load(fh)

    classic = cv2.QRCodeDetector()
    wechat = cv2.wechat_qrcode_WeChatQRCode()

    out = []
    for entry in manifest:
        path = entry["path"]
        img = cv2.imread(path)
        if img is None:
            out.append(
                {"path": path, "expect": entry.get("expect"),
                 "qrcode_detector": None, "wechat": None}
            )
            continue
        out.append(
            {
                "path": path,
                "expect": entry.get("expect"),
                "qrcode_detector": decode_classic(classic, img),
                "wechat": decode_wechat(wechat, img),
            }
        )
    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
