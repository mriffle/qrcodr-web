import { describe, expect, test } from 'vitest';
import { payloadToFilenameSlug } from '../../src/lib/download';

describe('payloadToFilenameSlug', () => {
  test('strips http(s) protocol', () => {
    expect(payloadToFilenameSlug('https://example.com')).toBe('example-com');
    expect(payloadToFilenameSlug('http://example.com')).toBe('example-com');
  });

  test('replaces non-alphanumeric runs with a single dash', () => {
    expect(payloadToFilenameSlug('hello world!! foo')).toBe('hello-world-foo');
  });

  test('lowercases all letters', () => {
    expect(payloadToFilenameSlug('HelloWorld')).toBe('helloworld');
  });

  test('truncates to a max length', () => {
    const long = 'a'.repeat(100);
    expect(payloadToFilenameSlug(long, 10)).toBe('a'.repeat(10));
  });

  test('trims leading and trailing dashes', () => {
    expect(payloadToFilenameSlug('-foo-bar-')).toBe('foo-bar');
  });

  test('trims trailing dashes left behind by truncation', () => {
    // "abc-defgh" truncated at 4 = "abc-" → should become "abc"
    expect(payloadToFilenameSlug('abc-defgh', 4)).toBe('abc');
  });

  test('returns "qrcode" fallback when slug would be empty', () => {
    expect(payloadToFilenameSlug('!!!')).toBe('qrcode');
    expect(payloadToFilenameSlug('   ')).toBe('qrcode');
  });

  test('handles long URLs by stripping protocol and slugifying path', () => {
    expect(payloadToFilenameSlug('https://www.example.com/path/to/page?query=value', 30)).toBe(
      'www-example-com-path-to-page-q',
    );
  });
});
