import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  CENTER_TEXT_MAX_LENGTH,
  MODULE_SWATCH_VIEWBOX,
  moduleSwatchPath,
  type QrResult,
  type QrStyle,
} from '../lib/qr';
import { CENTER_ICONS, type CenterIconDef } from '../lib/center-icons';

type Props = {
  qr: QrResult | null;
  rawPayload: string;
  style: QrStyle;
  centerIcon: CenterIconDef;
  centerText: string;
  onForegroundChange: (next: string) => void;
  onBackgroundChange: (next: string) => void;
  onModuleShapeChange: (next: QrStyle['moduleShape']) => void;
  onCenterIconChange: (next: CenterIconDef) => void;
  onCenterTextChange: (next: string) => void;
};

/**
 * Telemetry panel — QR metadata displayed alongside the preview, never
 * overlaid on the scannable matrix itself.
 */
export function MetadataRows({
  qr,
  rawPayload,
  style,
  centerIcon,
  centerText,
  onForegroundChange,
  onBackgroundChange,
  onModuleShapeChange,
  onCenterIconChange,
  onCenterTextChange,
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
      <SwatchRow label="Foreground" color={style.foreground} onChange={onForegroundChange} />
      <SwatchRow label="Background" color={style.background} onChange={onBackgroundChange} />
      <ShapeRow
        shape={style.moduleShape}
        foreground={style.foreground}
        background={style.background}
        onChange={onModuleShapeChange}
      />
      <CenterIconRow
        value={centerIcon}
        foreground={style.foreground}
        background={style.background}
        onChange={onCenterIconChange}
      />
      <CenterTextRow value={centerText} onChange={onCenterTextChange} />
    </section>
  );
}

function CenterTextRow({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className="telemetry__row telemetry__row--text" data-label="Center text">
      <span className="telemetry__label">Center text</span>
      <span className="center-text-input">
        <span className="center-text-input__prompt" aria-hidden="true">
          ./inscribe &gt;
        </span>
        <input
          type="text"
          className="center-text-input__field"
          value={value}
          maxLength={CENTER_TEXT_MAX_LENGTH}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          placeholder="——"
          aria-label="Center text label (up to 10 characters)"
          data-testid="center-text-input"
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      </span>
    </div>
  );
}

const MODULE_SHAPES: { value: QrStyle['moduleShape']; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'chamfer', label: 'Chamfer' },
  { value: 'dot', label: 'Dot' },
  { value: 'horizontal-pill', label: 'Horizontal Pill' },
  { value: 'vertical-pill', label: 'Vertical Pill' },
];

function ShapeRow({
  shape,
  foreground,
  background,
  onChange,
}: {
  shape: QrStyle['moduleShape'];
  foreground: string;
  background: string;
  onChange: (next: QrStyle['moduleShape']) => void;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'down' | 'up'>('down');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const current = MODULE_SHAPES.find((s) => s.value === shape) ?? {
    value: 'square' as const,
    label: 'Square',
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDocPointer = (e: PointerEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Open downward by default, but flip up when the menu would overflow the
  // viewport bottom and there's more room above. Runs before paint so the
  // menu never appears in the wrong place.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current.offsetHeight;
    const margin = 12;
    const spaceBelow = window.innerHeight - trigger.bottom - margin;
    const spaceAbove = trigger.top - margin;
    setPlacement(spaceBelow < menuHeight && spaceAbove > spaceBelow ? 'up' : 'down');
  }, [open]);

  return (
    <div className="telemetry__row telemetry__row--shape" data-label="Module shape" ref={rootRef}>
      <span className="telemetry__label">Module shape</span>
      <span className="shape-picker">
        <button
          ref={triggerRef}
          type="button"
          className="shape-picker__trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={`Pick module shape (current ${current.label})`}
          data-testid="module-shape-trigger"
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          <ShapeSwatch shape={current.value} foreground={foreground} background={background} />
          <span className="shape-picker__current">{current.label}</span>
          <span className="shape-picker__chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        {open && (
          <div
            ref={menuRef}
            id={menuId}
            className={`shape-picker__menu shape-picker__menu--${placement}`}
            role="dialog"
            aria-label="Module shapes"
          >
            <div className="shape-picker__grid">
              {MODULE_SHAPES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className="shape-picker__option"
                  data-active={s.value === shape}
                  aria-pressed={s.value === shape}
                  data-testid={`module-shape-${s.value}`}
                  title={s.label}
                  onClick={() => {
                    onChange(s.value);
                    setOpen(false);
                  }}
                >
                  <ShapeSwatch shape={s.value} foreground={foreground} background={background} />
                  <span className="shape-picker__option-label">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </span>
    </div>
  );
}

/** Faithful preview swatch of a module shape, rendered via the real path pipeline. */
function ShapeSwatch({
  shape,
  foreground,
  background,
}: {
  shape: QrStyle['moduleShape'];
  foreground: string;
  background: string;
}) {
  return (
    <span className="shape-swatch" aria-hidden="true">
      <svg
        viewBox={MODULE_SWATCH_VIEWBOX}
        width="100%"
        height="100%"
        focusable="false"
        preserveAspectRatio="xMidYMid meet"
      >
        <rect x="0" y="0" width="20" height="20" fill={background} />
        <path d={moduleSwatchPath(shape)} fill={foreground} />
      </svg>
    </span>
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

function CenterIconRow({
  value,
  foreground,
  background,
  onChange,
}: {
  value: CenterIconDef;
  foreground: string;
  background: string;
  onChange: (next: CenterIconDef) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDocPointer = (e: PointerEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="telemetry__row telemetry__row--icon" data-label="Center icon" ref={rootRef}>
      <span className="telemetry__label">Center icon</span>
      <span className="icon-picker">
        <span className="telemetry__value">{value.label}</span>
        <button
          type="button"
          className="icon-picker__trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={`Pick center icon (current ${value.label})`}
          title="Pick center icon"
          data-testid="center-icon-trigger"
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          <IconGlyph icon={value} foreground={foreground} background={background} />
        </button>
        {open && (
          <div
            id={menuId}
            className="icon-picker__menu"
            role="dialog"
            aria-label="Center icon options"
          >
            <div className="icon-picker__grid">
              {CENTER_ICONS.map((icon) => (
                <button
                  key={icon.id}
                  type="button"
                  className="icon-picker__option"
                  data-active={icon.id === value.id}
                  aria-pressed={icon.id === value.id}
                  data-testid={`center-icon-option-${icon.id}`}
                  onClick={() => {
                    onChange(icon);
                    setOpen(false);
                  }}
                  title={icon.label}
                >
                  <IconGlyph icon={icon} foreground={foreground} background={background} />
                  <span className="icon-picker__option-label">{icon.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </span>
    </div>
  );
}

function IconGlyph({
  icon,
  foreground,
  background,
}: {
  icon: CenterIconDef;
  foreground: string;
  background: string;
}) {
  if (icon.innerSvg.length === 0) {
    return (
      <span className="icon-glyph icon-glyph--none" style={{ background }} aria-hidden="true">
        <span className="icon-glyph__strike" />
      </span>
    );
  }
  return (
    <span className="icon-glyph" style={{ background, color: foreground }} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width="100%"
        height="100%"
        focusable="false"
        dangerouslySetInnerHTML={{ __html: icon.innerSvg }}
      />
    </span>
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
          <svg className="swatch__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
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
