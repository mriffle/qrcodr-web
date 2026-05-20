import { useMemo, useState } from 'react';
import { TitleBlock } from './components/TitleBlock';
import { PayloadInput } from './components/PayloadInput';
import { QrDrawing } from './components/QrDrawing';
import { MetadataRows } from './components/MetadataRows';
import { ExportRow } from './components/ExportRow';
import { validatePayload } from './lib/payload';
import { DEFAULT_STYLE, generateQr, type QrResult, type QrStyle } from './lib/qr';

export function App() {
  const [rawPayload, setRawPayload] = useState('https://example.com');
  const [foreground, setForeground] = useState(DEFAULT_STYLE.foreground);
  const [background, setBackground] = useState(DEFAULT_STYLE.background);
  const [moduleShape, setModuleShape] = useState<QrStyle['moduleShape']>(DEFAULT_STYLE.moduleShape);

  const style = useMemo(
    () => ({ ...DEFAULT_STYLE, foreground, background, moduleShape }),
    [foreground, background, moduleShape],
  );

  const validation = useMemo(() => validatePayload(rawPayload), [rawPayload]);

  const qr: QrResult | null = useMemo(() => {
    if (!validation.ok) return null;
    try {
      return generateQr(validation.value);
    } catch {
      return null;
    }
  }, [validation]);

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
          rawPayload={rawPayload}
          style={style}
          onForegroundChange={setForeground}
          onBackgroundChange={setBackground}
          onModuleShapeChange={setModuleShape}
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
