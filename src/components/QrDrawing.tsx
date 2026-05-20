import { QUIET_ZONE, qrToSvgPath, shapeRenderingFor, type QrResult, type QrStyle } from '../lib/qr';

type Props = {
  qr: QrResult | null;
  style: QrStyle;
};

/**
 * Renders ONLY the bare scannable QR matrix (plus quiet zone) — no
 * dimension lines, no version stamps, no labels overlaid on the code.
 * Any metadata about the QR is displayed elsewhere in the page.
 *
 * Path generation is delegated to `qrToSvgPath` so the preview and the
 * exported SVG cannot drift apart: any change to module geometry is
 * picked up by both call sites simultaneously.
 *
 * The on-page lime glow around the QR comes from the parent .qr-frame
 * box-shadow; this component just paints modules on a white square.
 */
export function QrDrawing({ qr, style }: Props) {
  if (!qr) {
    return (
      <div className="qr-frame qr-frame--empty" data-empty="true">
        <div className="qr-drawing">
          <svg
            className="qr-drawing__svg"
            viewBox="0 0 100 100"
            role="img"
            aria-label="No QR generated yet"
          >
            <circle className="qr-empty-pulse" cx="50" cy="50" r="22" />
            <circle className="qr-empty-pulse" cx="50" cy="50" r="32" />
            <text
              className="qr-empty-label"
              x="50"
              y="52"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              awaiting payload
            </text>
          </svg>
        </div>
      </div>
    );
  }

  const { matrix, size, version } = qr;
  const total = size + QUIET_ZONE * 2;
  const d = qrToSvgPath(matrix, size, version, style);
  const shapeRendering = shapeRenderingFor(style);

  return (
    <div
      className="qr-frame"
      data-modules={size}
      data-version={version}
      style={{ ['--qr-bg' as string]: style.background }}
    >
      <div className="qr-drawing">
        <svg
          className="qr-drawing__svg"
          viewBox={`0 0 ${String(total)} ${String(total)}`}
          shapeRendering={shapeRendering}
          role="img"
          aria-label={`QR code, ${String(size)} by ${String(size)} modules, version ${String(version)}`}
        >
          <rect x={0} y={0} width={total} height={total} fill={style.background} />
          <path d={d} fill={style.foreground} />
        </svg>
      </div>
    </div>
  );
}
