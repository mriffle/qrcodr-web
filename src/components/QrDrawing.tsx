import type { ReactNode } from 'react';
import { QUIET_ZONE, type QrResult, type QrStyle } from '../lib/qr';

type Props = {
  qr: QrResult | null;
  style: QrStyle;
};

const PAD = 14;
const QR_AREA = 200;
const VIEW = QR_AREA + PAD * 2;

export function QrDrawing({ qr, style }: Props) {
  if (!qr) {
    return (
      <div className="qr-drawing qr-drawing--empty" data-empty="true">
        <svg
          className="qr-drawing__svg"
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          role="img"
          aria-label="No QR generated yet"
        >
          <rect className="qr-paper" x={PAD} y={PAD} width={QR_AREA} height={QR_AREA} />
          <CornerRegMarks />
          <text className="qr-empty-label" x={VIEW / 2} y={VIEW / 2 + 2} textAnchor="middle">
            awaiting payload
          </text>
        </svg>
      </div>
    );
  }

  const { matrix, size, version } = qr;
  const totalModules = size + QUIET_ZONE * 2;
  const moduleSize = QR_AREA / totalModules;
  const qrOrigin = PAD;
  const qrEnd = PAD + QR_AREA;
  const modulesStart = qrOrigin + QUIET_ZONE * moduleSize;
  const modulesEnd = qrEnd - QUIET_ZONE * moduleSize;

  const modules: ReactNode[] = [];
  for (let y = 0; y < size; y++) {
    const rowOffset = y * size;
    for (let x = 0; x < size; x++) {
      if (matrix[rowOffset + x] === 1) {
        modules.push(
          <rect
            key={`${String(x)}-${String(y)}`}
            x={modulesStart + x * moduleSize}
            y={modulesStart + y * moduleSize}
            width={moduleSize}
            height={moduleSize}
            fill={style.foreground}
          />,
        );
      }
    }
  }

  const dimY = qrEnd - 4;
  const labelText = `${String(size)} × ${String(size)} mod`;
  const labelWidth = labelText.length * 2.6 + 2;
  const labelCenter = (modulesStart + modulesEnd) / 2;

  const stampText = `ec.h · v.${String(version)}`;
  const stampWidth = stampText.length * 2.4;

  return (
    <div className="qr-drawing" data-modules={size} data-version={version}>
      <svg
        className="qr-drawing__svg"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`QR code, ${String(size)} by ${String(size)} modules, version ${String(version)}`}
      >
        <rect
          className="qr-paper"
          x={qrOrigin}
          y={qrOrigin}
          width={QR_AREA}
          height={QR_AREA}
          fill={style.background}
        />
        <CornerRegMarks />
        <g>{modules}</g>

        {/* Bottom dimension line: arrows + module count label */}
        <g className="dim-line">
          <line x1={modulesStart} y1={dimY} x2={modulesEnd} y2={dimY} />
          <line x1={modulesStart} y1={dimY - 1.6} x2={modulesStart} y2={dimY + 1.6} />
          <line x1={modulesEnd} y1={dimY - 1.6} x2={modulesEnd} y2={dimY + 1.6} />
          {/* Arrowheads */}
          <polyline
            points={`${String(modulesStart + 1.6)},${String(dimY - 0.9)} ${String(modulesStart)},${String(dimY)} ${String(modulesStart + 1.6)},${String(dimY + 0.9)}`}
            className="dim-line"
          />
          <polyline
            points={`${String(modulesEnd - 1.6)},${String(dimY - 0.9)} ${String(modulesEnd)},${String(dimY)} ${String(modulesEnd - 1.6)},${String(dimY + 0.9)}`}
            className="dim-line"
          />
          <rect
            className="dim-line__label-bg"
            x={labelCenter - labelWidth / 2}
            y={dimY - 3.2}
            width={labelWidth}
            height={6.4}
          />
          <text className="dim-line__label" x={labelCenter} y={dimY + 1.6} textAnchor="middle">
            {labelText}
          </text>
        </g>

        {/* Stamp in bottom-right of paper */}
        <g>
          <rect
            className="dim-line__label-bg"
            x={qrEnd - stampWidth - 4}
            y={qrEnd - 8}
            width={stampWidth + 2}
            height={5}
          />
          <text
            className="qr-stamp"
            x={qrEnd - stampWidth / 2 - 3}
            y={qrEnd - 4.2}
            textAnchor="middle"
          >
            {stampText}
          </text>
        </g>
      </svg>
    </div>
  );
}

function CornerRegMarks() {
  const inset = 5;
  return (
    <>
      <RegMark cx={inset} cy={inset} />
      <RegMark cx={VIEW - inset} cy={inset} />
      <RegMark cx={inset} cy={VIEW - inset} />
      <RegMark cx={VIEW - inset} cy={VIEW - inset} />
    </>
  );
}

function RegMark({ cx, cy }: { cx: number; cy: number }) {
  const r = 2.2;
  return (
    <g>
      <circle className="reg-mark" cx={cx} cy={cy} r={r} />
      <line className="reg-mark" x1={cx - r - 1} y1={cy} x2={cx + r + 1} y2={cy} />
      <line className="reg-mark" x1={cx} y1={cy - r - 1} x2={cx} y2={cy + r + 1} />
      <circle className="reg-mark__dot" cx={cx} cy={cy} r={0.4} />
    </g>
  );
}
