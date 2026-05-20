import type { QrResult, QrStyle } from '../lib/qr';

type Props = {
  qr: QrResult | null;
  rawPayload: string;
  style: QrStyle;
};

export function MetadataRows({ qr, rawPayload, style }: Props) {
  const trimmed = rawPayload.trim();
  return (
    <section className="meta" aria-label="QR metadata">
      <Row
        label="Payload"
        value={trimmed.length > 0 ? trimmed : '—'}
        muted={trimmed.length === 0}
      />
      <Row label="Encoding" value="byte · utf-8" />
      <Row label="Error Corr." value="H · 30%" />
      <Row label="Version" value={qr ? String(qr.version) : '—'} muted={!qr} />
      <Row
        label="Modules"
        value={qr ? `${String(qr.size)} × ${String(qr.size)}` : '—'}
        muted={!qr}
      />
      <Row label="Foreground" value={style.foreground.toUpperCase()} />
      <Row label="Background" value={style.background.toUpperCase()} />
    </section>
  );
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="meta__row" data-label={label}>
      <span className="meta__glyph" aria-hidden="true">
        ▸
      </span>
      <span className="meta__label">{label}</span>
      <span className={muted ? 'meta__value meta__value--muted' : 'meta__value'}>{value}</span>
    </div>
  );
}
