import { useMemo, useState } from 'react';
import { TitleBlock } from './components/TitleBlock';
import { PayloadInput } from './components/PayloadInput';
import { QrDrawing } from './components/QrDrawing';
import { MetadataRows } from './components/MetadataRows';
import { ExportRow } from './components/ExportRow';
import { validatePayload } from './lib/payload';
import {
  DEFAULT_STYLE,
  generateQr,
  MIN_OVERLAY_VERSION,
  sanitizeCenterText,
  styleHasOverlay,
  type QrResult,
  type QrStyle,
} from './lib/qr';
import { NONE_ICON, type CenterIconDef } from './lib/center-icons';

export function App() {
  const [rawPayload, setRawPayload] = useState('https://example.com');
  const [foreground, setForeground] = useState(DEFAULT_STYLE.foreground);
  const [background, setBackground] = useState(DEFAULT_STYLE.background);
  const [moduleShape, setModuleShape] = useState<QrStyle['moduleShape']>(DEFAULT_STYLE.moduleShape);
  const [finderShape, setFinderShape] = useState<QrStyle['finderShape']>(DEFAULT_STYLE.finderShape);
  const [centerIcon, setCenterIcon] = useState<CenterIconDef>(NONE_ICON);
  const [centerText, setCenterText] = useState('');

  const style = useMemo<QrStyle>(() => {
    const sanitized = sanitizeCenterText(centerText);
    return {
      ...DEFAULT_STYLE,
      foreground,
      background,
      moduleShape,
      finderShape,
      centerIcon:
        centerIcon.id === 'none' ? null : { id: centerIcon.id, innerSvg: centerIcon.innerSvg },
      centerText: sanitized.length > 0 ? sanitized : null,
    };
  }, [foreground, background, moduleShape, finderShape, centerIcon, centerText]);

  const validation = useMemo(() => validatePayload(rawPayload), [rawPayload]);

  // Overlays occlude central codewords; floor the version so a sub-min code
  // can't be rendered unscannable (see MIN_OVERLAY_VERSION). Depend on the
  // boolean, not `style`, so colour changes don't regenerate the matrix.
  const hasOverlay = styleHasOverlay(style);
  const qr: QrResult | null = useMemo(() => {
    if (!validation.ok) return null;
    try {
      return generateQr(
        validation.value,
        hasOverlay ? { minVersion: MIN_OVERLAY_VERSION } : undefined,
      );
    } catch {
      return null;
    }
  }, [validation, hasOverlay]);

  const error = validation.ok ? null : validation.error;

  const stageReadout = qr
    ? `Lock acquired :: v${String(qr.version)} · ${String(qr.size)}×${String(qr.size)} mod`
    : 'Standby :: awaiting payload';

  return (
    <main className="deck">
      <TitleBlock />

      <div className="console">
        <PayloadInput value={rawPayload} onChange={setRawPayload} error={error} />
        <MetadataRows
          qr={qr}
          style={style}
          centerIcon={centerIcon}
          centerText={centerText}
          onForegroundChange={setForeground}
          onBackgroundChange={setBackground}
          onModuleShapeChange={setModuleShape}
          onFinderShapeChange={setFinderShape}
          onCenterIconChange={setCenterIcon}
          onCenterTextChange={setCenterText}
        />
      </div>

      <section
        className="stage"
        aria-label="QR preview viewport"
        data-state={qr ? 'lock' : 'standby'}
      >
        <span className="stage__crosshair" aria-hidden="true" />
        <span className="stage__bracket stage__bracket--tl" aria-hidden="true" />
        <span className="stage__bracket stage__bracket--tr" aria-hidden="true" />
        <span className="stage__bracket stage__bracket--bl" aria-hidden="true" />
        <span className="stage__bracket stage__bracket--br" aria-hidden="true" />
        <span className={qr ? 'stage__readout' : 'stage__readout stage__readout--coral'}>
          {stageReadout}
        </span>
        <QrDrawing qr={qr} style={style} />
      </section>

      <ExportRow qr={qr} style={style} />
    </main>
  );
}
