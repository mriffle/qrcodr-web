import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportRow } from '../../src/components/ExportRow';
import { DEFAULT_STYLE, generateQr } from '../../src/lib/qr';
import { validatePayload } from '../../src/lib/payload';
import { downloadBlob, svgToPng } from '../../src/lib/download';
import type * as DownloadModule from '../../src/lib/download';

vi.mock('../../src/lib/download', async (importOriginal) => {
  const actual = await importOriginal<typeof DownloadModule>();
  return {
    ...actual,
    // jsdom has no canvas/image pipeline, so the PNG path is mocked per-test.
    svgToPng: vi.fn(),
    downloadBlob: vi.fn(),
  };
});

function makeQr() {
  const validation = validatePayload('https://example.com');
  if (!validation.ok) throw new Error('fixture payload must validate');
  return generateQr(validation.value);
}

describe('<ExportRow />', () => {
  test('disables both export buttons without a QR', () => {
    render(<ExportRow qr={null} style={DEFAULT_STYLE} />);
    expect(screen.getByTestId('export-png')).toBeDisabled();
    expect(screen.getByTestId('export-svg')).toBeDisabled();
  });

  test('downloads the SVG artifact on click', async () => {
    const user = userEvent.setup();
    render(<ExportRow qr={makeQr()} style={DEFAULT_STYLE} />);
    await user.click(screen.getByTestId('export-svg'));
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'example-com.svg');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('downloads the PNG artifact when rasterization succeeds', async () => {
    const user = userEvent.setup();
    vi.mocked(svgToPng).mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));
    render(<ExportRow qr={makeQr()} style={DEFAULT_STYLE} />);
    await user.click(screen.getByTestId('export-png'));
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'example-com.png');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('shows a coral system alert when PNG rasterization fails', async () => {
    const user = userEvent.setup();
    vi.mocked(svgToPng).mockRejectedValueOnce(new Error('failed to load svg as image'));
    render(<ExportRow qr={makeQr()} style={DEFAULT_STYLE} />);
    await user.click(screen.getByTestId('export-png'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/eject failed :: png/i);
    expect(downloadBlob).not.toHaveBeenCalled();
    // The button unlocks again so the user can retry.
    expect(screen.getByTestId('export-png')).toBeEnabled();
  });

  test('clears the alert when a later export starts', async () => {
    const user = userEvent.setup();
    vi.mocked(svgToPng)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));
    render(<ExportRow qr={makeQr()} style={DEFAULT_STYLE} />);
    await user.click(screen.getByTestId('export-png'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByTestId('export-png'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
