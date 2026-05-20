import { useCallback, useState } from 'react';
import { qrToSvgString, type QrResult, type QrStyle } from '../lib/qr';
import { downloadBlob, payloadToFilenameSlug, svgToPng } from '../lib/download';

type Props = {
  qr: QrResult | null;
  style: QrStyle;
};

const PNG_OUTPUT_SIZE = 1024;

type Pending = 'png' | 'svg' | null;

export function ExportRow({ qr, style }: Props) {
  const [pending, setPending] = useState<Pending>(null);

  const handleSvg = useCallback(() => {
    if (!qr) return;
    setPending('svg');
    try {
      const svg = qrToSvgString(qr, style);
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const name = `${payloadToFilenameSlug(qr.payload)}.svg`;
      downloadBlob(blob, name);
    } finally {
      setPending(null);
    }
  }, [qr, style]);

  const handlePng = useCallback(async () => {
    if (!qr) return;
    setPending('png');
    try {
      const svg = qrToSvgString(qr, style);
      const blob = await svgToPng(svg, PNG_OUTPUT_SIZE);
      const name = `${payloadToFilenameSlug(qr.payload)}.png`;
      downloadBlob(blob, name);
    } finally {
      setPending(null);
    }
  }, [qr, style]);

  const disabled = qr === null;

  return (
    <footer className="export-row" aria-label="Export actions">
      <div className="export-row__label">
        <span className="export-row__diamond" aria-hidden="true">
          ◇
        </span>
        <span>Export</span>
      </div>
      <div className="export-row__actions">
        <button
          type="button"
          className="export-button"
          onClick={() => {
            void handlePng();
          }}
          disabled={disabled || pending !== null}
          data-format="png"
          data-testid="export-png"
        >
          <span className="export-button__chevron" aria-hidden="true">
            ▸
          </span>
          <span>{pending === 'png' ? 'Rasterizing…' : 'PNG'}</span>
        </button>
        <button
          type="button"
          className="export-button"
          onClick={handleSvg}
          disabled={disabled || pending !== null}
          data-format="svg"
          data-testid="export-svg"
        >
          <span className="export-button__chevron" aria-hidden="true">
            ▸
          </span>
          <span>{pending === 'svg' ? 'Writing…' : 'SVG'}</span>
        </button>
      </div>
    </footer>
  );
}
