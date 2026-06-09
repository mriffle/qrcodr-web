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
 * Max byte-mode capacity for a version-40 QR at error-correction level H,
 * in UTF-8 **bytes** (the `qrcode` library encodes byte mode as UTF-8).
 * See ISO/IEC 18004 capacity tables. Choosing a hard ceiling avoids the
 * `qrcode` library throwing late in the render pipeline.
 */
export const MAX_PAYLOAD_LENGTH = 1273;

const utf8 = new TextEncoder();

export function validatePayload(raw: string): ValidationResult {
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, error: 'empty' };
  }
  // Measure UTF-8 bytes, not UTF-16 code units: the capacity ceiling is a
  // byte count, and multi-byte characters (é, emoji, CJK) take 2–4 bytes
  // each. Counting `.length` would let e.g. 700 × "é" (1400 bytes) through
  // validation only to blow up inside QRCode.create.
  if (utf8.encode(value).length > MAX_PAYLOAD_LENGTH) {
    return { ok: false, error: 'too-long' };
  }
  return { ok: true, value: value as ValidatedPayload };
}

export function describeError(error: ValidationError): string {
  switch (error) {
    case 'empty':
      return 'Payload required';
    case 'too-long':
      return `Exceeds ${MAX_PAYLOAD_LENGTH} bytes`;
  }
}
