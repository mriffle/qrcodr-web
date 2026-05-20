import type { QrResult, QrStyle } from '../lib/qr';

type Props = {
  qr: QrResult | null;
  rawPayload: string;
  style: QrStyle;
  onForegroundChange: (next: string) => void;
  onBackgroundChange: (next: string) => void;
};

/**
 * Telemetry panel — QR metadata displayed alongside the preview, never
 * overlaid on the scannable matrix itself.
 */
export function MetadataRows({
  qr,
  rawPayload,
  style,
  onForegroundChange,
  onBackgroundChange,
}: Props) {
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
      <SwatchRow
        label="Foreground"
        color={style.foreground}
        onChange={onForegroundChange}
      />
      <SwatchRow
        label="Background"
        color={style.background}
        onChange={onBackgroundChange}
      />
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

function SwatchRow({
  label,
  color,
  onChange,
}: {
  label: string;
  color: string;
  onChange: (next: string) => void;
}) {
  const hex = color.toUpperCase();
  return (
    <div className="telemetry__row telemetry__row--swatch" data-label={label}>
      <span className="telemetry__label">{label}</span>
      <span className="telemetry__swatch-value">
        <span className="telemetry__value">{hex}</span>
        <label
          className="swatch"
          style={{ background: color }}
          aria-label={`Pick ${label.toLowerCase()} color (current ${hex})`}
          title={`Pick ${label.toLowerCase()} color`}
        >
          <svg
            className="swatch__icon"
            viewBox="0 0 16 16"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M11.2 1.5a2 2 0 0 1 2.83 2.83l-1.3 1.3-2.83-2.83 1.3-1.3Zm-2 2 2.83 2.83-6.4 6.4-3.06.7a.5.5 0 0 1-.6-.6l.7-3.06 6.53-6.27Z"
              fill="currentColor"
            />
          </svg>
          <input
            type="color"
            className="swatch__input"
            value={color}
            onChange={(e) => {
              onChange(e.target.value);
            }}
            aria-label={`${label} color value`}
          />
        </label>
      </span>
    </div>
  );
}
