import type { QrResult, QrStyle } from '../lib/qr';

type Props = {
  qr: QrResult | null;
  rawPayload: string;
  style: QrStyle;
};

/**
 * Telemetry panel — QR metadata displayed alongside the preview, never
 * overlaid on the scannable matrix itself.
 */
export function MetadataRows({ qr, rawPayload, style }: Props) {
  const trimmed = rawPayload.trim();
  return (
    <section className="telemetry" aria-label="QR telemetry">
      <div className="telemetry__title">
        <span className="telemetry__title-glyph" aria-hidden="true">
          [//]
        </span>
        Telemetry :: Spec
      </div>
      <Row
        label="Payload"
        value={trimmed.length > 0 ? trimmed : '—'}
        muted={trimmed.length === 0}
      />
      <Row label="Encoding" value="byte · utf-8" />
      <Row label="EC level" value="H · 30%" highlight />
      <Row
        label="Version"
        value={qr ? `v${String(qr.version)}` : '—'}
        muted={!qr}
        highlight={!!qr}
      />
      <Row
        label="Modules"
        value={qr ? `${String(qr.size)} × ${String(qr.size)}` : '—'}
        muted={!qr}
      />
      <Row label="Quiet zone" value="4 mod" />
      <Row label="FG" value={style.foreground.toUpperCase()} />
      <Row label="BG" value={style.background.toUpperCase()} />
    </section>
  );
}

function Row({
  label,
  value,
  muted = false,
  highlight = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
  highlight?: boolean;
}) {
  const valueClass = muted
    ? 'telemetry__value telemetry__value--muted'
    : highlight
      ? 'telemetry__value telemetry__value--lime'
      : 'telemetry__value';
  return (
    <div className="telemetry__row" data-label={label}>
      <span className="telemetry__label">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}
