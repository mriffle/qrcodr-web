import { useCallback, useState } from 'react';
import { qrToSvgString, type QrResult, type QrStyle } from '../lib/qr';
import { downloadBlob, payloadToFilenameSlug, svgToPng } from '../lib/download';

type Props = {
  qr: QrResult | null;
  style: QrStyle;
};

const PNG_OUTPUT_SIZE = 1024;

/**
 * Export drawer — parallelogram action chips for PNG / SVG export.
 * Lime sigil for PNG, coral for SVG.
 */
export function ExportRow({ qr, style }: Props) {
  // Only the PNG path has an observable in-flight state: it awaits the
  // canvas rasterization. The SVG export is synchronous, so a pending flag
  // for it could never render (React batches the set/unset into one pass).
  const [rasterizing, setRasterizing] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleSvg = useCallback(() => {
    if (!qr) return;
    setExportError(null);
    try {
      const svg = qrToSvgString(qr, style);
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const name = `${payloadToFilenameSlug(qr.payload)}.svg`;
      downloadBlob(blob, name);
    } catch {
      setExportError('Eject failed :: SVG write error');
    }
  }, [qr, style]);

  const handlePng = useCallback(async () => {
    if (!qr) return;
    setRasterizing(true);
    setExportError(null);
    try {
      const svg = qrToSvgString(qr, style);
      const blob = await svgToPng(svg, PNG_OUTPUT_SIZE);
      const name = `${payloadToFilenameSlug(qr.payload)}.png`;
      downloadBlob(blob, name);
    } catch {
      setExportError('Eject failed :: PNG rasterization error');
    } finally {
      setRasterizing(false);
    }
  }, [qr, style]);

  const disabled = qr === null;

  return (
    <footer className="drawer" aria-label="Export actions">
      <div className="drawer__legend">
        <span className="drawer__legend-title">Eject :: Artifact</span>
        <span className="drawer__legend-sub">
          {disabled ? 'No payload locked' : 'Ready · 2 formats'}
        </span>
        {exportError !== null && (
          <span className="drawer__alert" role="alert">
            {exportError}
          </span>
        )}
      </div>
      <div className="drawer__actions">
        <button
          type="button"
          className="export-button"
          onClick={() => {
            void handlePng();
          }}
          disabled={disabled || rasterizing}
          data-format="png"
          data-testid="export-png"
        >
          <span className="export-button__sigil" aria-hidden="true">
            ▸
          </span>
          <span>{rasterizing ? 'Rasterizing' : 'PNG · 1024'}</span>
        </button>
        <button
          type="button"
          className="export-button"
          onClick={handleSvg}
          disabled={disabled || rasterizing}
          data-format="svg"
          data-testid="export-svg"
        >
          <span className="export-button__sigil" aria-hidden="true">
            ◆
          </span>
          <span>SVG · vector</span>
        </button>
      </div>
    </footer>
  );
}
