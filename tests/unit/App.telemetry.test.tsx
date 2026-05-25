import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/App';

/**
 * Integration coverage for the telemetry panel's reactive readouts — the
 * Version/Modules rows in <MetadataRows> wired through <App/>'s memos. The
 * decode suite proves the exported artifact is scannable; this proves the
 * on-screen spec panel reflects the right `qr` as the payload and overlay
 * options change. First test to mount <App/> directly.
 */

/** Read a telemetry row's value cell by its `data-label`. */
function telemetryValue(label: string): string {
  const row = document.querySelector(`.telemetry__row[data-label="${label}"]`);
  if (!row) throw new Error(`no telemetry row labelled "${label}"`);
  const value = row.querySelector('.telemetry__value');
  if (!value) throw new Error(`row "${label}" has no value cell`);
  return value.textContent ?? '';
}

/** Parse the numeric version out of a `vN` readout. */
function versionNumber(): number {
  const match = /^v(\d+)$/.exec(telemetryValue('Version').trim());
  if (!match) throw new Error(`Version readout is not "vN": "${telemetryValue('Version')}"`);
  return Number(match[1]);
}

/** Parse the module count out of an `N × N` readout. */
function moduleCount(): number {
  const match = /^(\d+) × \d+$/.exec(telemetryValue('Modules').trim());
  if (!match) throw new Error(`Modules readout is not "N × N": "${telemetryValue('Modules')}"`);
  return Number(match[1]);
}

describe('telemetry panel · reactive readouts', () => {
  test('shows a live version + module count for the default payload', () => {
    render(<App />);
    expect(telemetryValue('Version')).toMatch(/^v\d+$/);
    expect(telemetryValue('Modules')).toMatch(/^\d+ × \d+$/);
    // Module count is the QR invariant: 17 + 4·version (v1=21, v2=25, …).
    expect(moduleCount()).toBe(17 + 4 * versionNumber());
  });

  test('collapses to "—" when the payload is emptied', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.clear(screen.getByTestId('payload-input'));
    expect(telemetryValue('Version')).toBe('—');
    expect(telemetryValue('Modules')).toBe('—');
  });

  test('version and module count grow with payload length', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByTestId('payload-input');

    await user.clear(input);
    await user.type(input, 'hi');
    const shortVersion = versionNumber();
    const shortModules = moduleCount();

    await user.clear(input);
    await user.type(
      input,
      'https://www.anthropic.com/research/very/long/path/with-many/segments?foo=bar&baz=qux',
    );
    expect(versionNumber()).toBeGreaterThan(shortVersion);
    expect(moduleCount()).toBeGreaterThan(shortModules);
  });

  test('selecting a center icon floors the version at the overlay minimum', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByTestId('payload-input');

    // A 2-byte payload is version 1 (21×21) on its own at EC level H.
    await user.clear(input);
    await user.type(input, 'hi');
    expect(versionNumber()).toBeLessThan(3);

    // Overlays occlude central codewords, so generateQr floors the version at
    // MIN_OVERLAY_VERSION (3) — the panel must surface that bump.
    await user.click(screen.getByTestId('center-icon-trigger'));
    await user.click(screen.getByTestId('center-icon-option-heart'));
    expect(versionNumber()).toBeGreaterThanOrEqual(3);
    expect(moduleCount()).toBe(17 + 4 * versionNumber());
  });

  test('telemetry readouts agree with the rendered preview matrix', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.clear(screen.getByTestId('payload-input'));
    await user.type(screen.getByTestId('payload-input'), 'https://example.com/path?q=1');

    const frame = document.querySelector('.qr-frame[data-modules]');
    if (!frame) throw new Error('no rendered QR frame');
    expect(versionNumber()).toBe(Number(frame.getAttribute('data-version')));
    expect(moduleCount()).toBe(Number(frame.getAttribute('data-modules')));
  });
});
