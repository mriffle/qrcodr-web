// Batch QR decoder using Apple's Vision framework — the actual detector iOS
// Camera / macOS use. This is the highest-fidelity "will it scan on an iPhone"
// check available without a physical device: it feeds our exported PNGs straight
// to VNDetectBarcodesRequest (QR symbology), bypassing only the camera/lens.
//
// Usage:   swift decode_qr.swift MANIFEST.json
// MANIFEST is a JSON array of {"path": "<abs png>", "expect": "<text>"}.
// Prints a JSON array to stdout: {"path", "expect", "vision": <string|null>}.
// A null means Vision found no QR payload in that image.
//
// macOS-only (Vision is an Apple framework); the test layer that calls this
// self-skips on other platforms.
import Foundation
import ImageIO
import Vision

struct Entry: Codable { let path: String; let expect: String? }
struct Row: Codable { let path: String; let expect: String?; let vision: String? }

func loadImage(_ path: String) -> CGImage? {
  let url = URL(fileURLWithPath: path) as CFURL
  guard let src = CGImageSourceCreateWithURL(url, nil),
    let img = CGImageSourceCreateImageAtIndex(src, 0, nil)
  else { return nil }
  return img
}

func decodeQR(_ image: CGImage) -> String? {
  let request = VNDetectBarcodesRequest()
  request.symbologies = [.qr]
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  do {
    try handler.perform([request])
  } catch {
    return nil
  }
  for observation in request.results ?? [] {
    if let payload = observation.payloadStringValue, !payload.isEmpty {
      return payload
    }
  }
  return nil
}

let args = CommandLine.arguments
guard args.count == 2 else {
  FileHandle.standardError.write(Data("usage: decode_qr.swift MANIFEST.json\n".utf8))
  exit(2)
}

do {
  let manifest = try Data(contentsOf: URL(fileURLWithPath: args[1]))
  let entries = try JSONDecoder().decode([Entry].self, from: manifest)
  let rows = entries.map { entry -> Row in
    guard let image = loadImage(entry.path) else {
      return Row(path: entry.path, expect: entry.expect, vision: nil)
    }
    return Row(path: entry.path, expect: entry.expect, vision: decodeQR(image))
  }
  FileHandle.standardOutput.write(try JSONEncoder().encode(rows))
} catch {
  FileHandle.standardError.write(Data("error: \(error)\n".utf8))
  exit(1)
}
