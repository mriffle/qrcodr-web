import type { ReactNode } from 'react';
import { QUIET_ZONE, type QrResult, type QrStyle } from '../lib/qr';

type Props = {
  qr: QrResult | null;
  style: QrStyle;
};

/**
 * Renders ONLY the bare scannable QR matrix (plus quiet zone) — no
 * dimension lines, no version stamps, no labels overlaid on the code.
 * Any metadata about the QR is displayed elsewhere in the page.
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

  const modules: ReactNode[] = [];
  for (let y = 0; y < size; y++) {
    const rowOffset = y * size;
    for (let x = 0; x < size; x++) {
      if (matrix[rowOffset + x] === 1) {
        modules.push(
          <rect
            key={`${String(x)}-${String(y)}`}
            x={QUIET_ZONE + x}
            y={QUIET_ZONE + y}
            width={1}
            height={1}
            fill={style.foreground}
          />,
        );
      }
    }
  }

  return (
    <div className="qr-frame" data-modules={size} data-version={version}>
      <div className="qr-drawing">
        <svg
          className="qr-drawing__svg"
          viewBox={`0 0 ${String(total)} ${String(total)}`}
          shapeRendering="crispEdges"
          role="img"
          aria-label={`QR code, ${String(size)} by ${String(size)} modules, version ${String(version)}`}
        >
          <rect
            className="qr-paper"
            x={0}
            y={0}
            width={total}
            height={total}
            fill={style.background}
          />
          <g>{modules}</g>
        </svg>
      </div>
    </div>
  );
}
