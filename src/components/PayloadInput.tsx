import { describeError, type ValidationError } from '../lib/payload';

type Props = {
  value: string;
  onChange: (next: string) => void;
  error: ValidationError | null;
};

export function PayloadInput({ value, onChange, error }: Props) {
  return (
    <section className="payload-input" data-error={error !== null} aria-label="Payload entry">
      <span className="payload-input__label">Payload</span>
      <span className="payload-input__chevron" aria-hidden="true">
        ▸
      </span>
      <input
        type="text"
        className="payload-input__field"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder="https://…"
        aria-label="QR code payload"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        data-testid="payload-input"
      />
      {error !== null && (
        <span className="payload-input__error" role="status">
          {describeError(error)}
        </span>
      )}
    </section>
  );
}
