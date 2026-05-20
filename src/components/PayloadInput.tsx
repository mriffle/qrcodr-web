import { describeError, type ValidationError } from '../lib/payload';

type Props = {
  value: string;
  onChange: (next: string) => void;
  error: ValidationError | null;
};

/**
 * Terminal-style command prompt for the payload. The label and prompt sigil
 * shift to coral when the input is invalid.
 */
export function PayloadInput({ value, onChange, error }: Props) {
  const isError = error !== null;
  return (
    <section
      className="payload-input"
      data-error={isError ? 'true' : 'false'}
      aria-label="Payload entry"
    >
      <div className="payload-input__head">
        <span className="payload-input__label">Input :: Payload</span>
        <span className="payload-input__address" aria-hidden="true">
          0x01
        </span>
      </div>
      <div className="payload-input__row">
        <span className="payload-input__prompt" aria-hidden="true">
          ./forge&nbsp;&gt;
        </span>
        <input
          type="text"
          className="payload-input__field"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder="enter URL or text…"
          aria-label="QR code payload"
          aria-invalid={isError}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          data-testid="payload-input"
        />
      </div>
      {isError && (
        <span className="payload-input__error" role="status">
          {describeError(error)}
        </span>
      )}
    </section>
  );
}
