import { describe, expect, test } from 'vitest';
import { MAX_PAYLOAD_LENGTH, describeError, validatePayload } from '../../src/lib/payload';

describe('validatePayload', () => {
  test('accepts a simple non-empty string', () => {
    const result = validatePayload('hello');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('hello');
  });

  test('accepts a URL', () => {
    const result = validatePayload('https://example.com');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('https://example.com');
  });

  test('trims surrounding whitespace', () => {
    const result = validatePayload('  hello  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('hello');
  });

  test('rejects an empty string with "empty" error', () => {
    const result = validatePayload('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('empty');
  });

  test('rejects whitespace-only string with "empty" error', () => {
    const result = validatePayload('   \t\n  ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('empty');
  });

  test('rejects payload over MAX_PAYLOAD_LENGTH with "too-long" error', () => {
    const tooLong = 'a'.repeat(MAX_PAYLOAD_LENGTH + 1);
    const result = validatePayload(tooLong);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('too-long');
  });

  test('accepts payload exactly at MAX_PAYLOAD_LENGTH', () => {
    const atMax = 'a'.repeat(MAX_PAYLOAD_LENGTH);
    const result = validatePayload(atMax);
    expect(result.ok).toBe(true);
  });

  test('trim happens before length check (whitespace does not pad)', () => {
    const padded = '  ' + 'a'.repeat(MAX_PAYLOAD_LENGTH) + '  ';
    const result = validatePayload(padded);
    expect(result.ok).toBe(true);
  });

  test('counts UTF-8 bytes, not UTF-16 code units (2-byte chars)', () => {
    // 700 chars but 1400 UTF-8 bytes — must be rejected, not passed through
    // to QRCode.create where it would throw and silently produce no QR.
    const result = validatePayload('é'.repeat(700));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('too-long');
  });

  test('counts UTF-8 bytes, not UTF-16 code units (4-byte emoji)', () => {
    // 350 emoji = 700 UTF-16 code units but 1400 UTF-8 bytes.
    const result = validatePayload('🙂'.repeat(350));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('too-long');
  });

  test('accepts a multi-byte payload exactly at the byte ceiling', () => {
    // 636 × "é" (1272 bytes) + "a" (1 byte) = exactly MAX_PAYLOAD_LENGTH.
    const atMax = 'é'.repeat(636) + 'a';
    const result = validatePayload(atMax);
    expect(result.ok).toBe(true);
  });

  test('rejects a multi-byte payload one byte over the ceiling', () => {
    // 636 × "é" + "aa" = MAX_PAYLOAD_LENGTH + 1 bytes.
    const result = validatePayload('é'.repeat(636) + 'aa');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('too-long');
  });
});

describe('describeError', () => {
  test('describes the empty error', () => {
    expect(describeError('empty')).toMatch(/required/i);
  });

  test('describes the too-long error and includes the limit', () => {
    const msg = describeError('too-long');
    expect(msg).toMatch(/exceed/i);
    expect(msg).toContain(String(MAX_PAYLOAD_LENGTH));
  });
});
