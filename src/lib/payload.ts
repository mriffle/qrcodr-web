/**
 * A payload string that has passed validation. The brand prevents callers
 * from passing arbitrary strings to QR generation — only the validator
 * can mint values of this type.
 */
declare const validatedPayloadBrand: unique symbol;
export type ValidatedPayload = string & { readonly [validatedPayloadBrand]: true };

export type ValidationError = 'empty' | 'too-long';

export type ValidationResult =
  | { ok: true; value: ValidatedPayload }
  | { ok: false; error: ValidationError };

/**
 * Max byte-mode capacity for a version-40 QR at error-correction level H.
 * See ISO/IEC 18004 capacity tables. Choosing a hard ceiling avoids the
 * `qrcode` library throwing late in the render pipeline.
 */
export const MAX_PAYLOAD_LENGTH = 1273;

export function validatePayload(raw: string): ValidationResult {
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, error: 'empty' };
  }
  if (value.length > MAX_PAYLOAD_LENGTH) {
    return { ok: false, error: 'too-long' };
  }
  return { ok: true, value: value as ValidatedPayload };
}

export function describeError(error: ValidationError): string {
  switch (error) {
    case 'empty':
      return 'Payload required';
    case 'too-long':
      return `Exceeds ${MAX_PAYLOAD_LENGTH} chars`;
  }
}
