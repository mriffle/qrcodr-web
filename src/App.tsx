import { useMemo, useState } from 'react';
import { TitleBlock } from './components/TitleBlock';
import { PayloadInput } from './components/PayloadInput';
import { QrDrawing } from './components/QrDrawing';
import { MetadataRows } from './components/MetadataRows';
import { ExportRow } from './components/ExportRow';
import { validatePayload } from './lib/payload';
import { DEFAULT_STYLE, generateQr, type QrResult } from './lib/qr';

export function App() {
  const [rawPayload, setRawPayload] = useState('https://example.com');

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

  return (
    <main className="apparatus">
      <TitleBlock />
      <PayloadInput value={rawPayload} onChange={setRawPayload} error={error} />
      <section className="qr-stage" aria-label="QR preview">
        <QrDrawing qr={qr} style={DEFAULT_STYLE} />
      </section>
      <MetadataRows qr={qr} rawPayload={rawPayload} style={DEFAULT_STYLE} />
      <ExportRow qr={qr} style={DEFAULT_STYLE} />
    </main>
  );
}
