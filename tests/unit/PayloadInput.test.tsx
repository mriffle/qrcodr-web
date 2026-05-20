import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PayloadInput } from '../../src/components/PayloadInput';

describe('<PayloadInput />', () => {
  test('renders the provided value', () => {
    render(<PayloadInput value="https://example.com" onChange={() => {}} error={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('https://example.com');
  });

  test('calls onChange when the user types', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PayloadInput value="" onChange={onChange} error={null} />);
    await user.type(screen.getByRole('textbox'), 'h');
    expect(onChange).toHaveBeenCalledWith('h');
  });

  test('renders the error message when error is set', () => {
    render(<PayloadInput value="" onChange={() => {}} error="empty" />);
    expect(screen.getByRole('status')).toHaveTextContent(/required/i);
  });

  test('renders the too-long error', () => {
    render(<PayloadInput value="x" onChange={() => {}} error="too-long" />);
    expect(screen.getByRole('status')).toHaveTextContent(/exceeds/i);
  });

  test('does not render an error message in valid state', () => {
    render(<PayloadInput value="x" onChange={() => {}} error={null} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('sets data-error="true" on the wrapper when error is set', () => {
    const { container } = render(<PayloadInput value="" onChange={() => {}} error="empty" />);
    const section = container.querySelector('.payload-input');
    expect(section).toHaveAttribute('data-error', 'true');
  });

  test('sets data-error="false" when valid', () => {
    const { container } = render(<PayloadInput value="x" onChange={() => {}} error={null} />);
    const section = container.querySelector('.payload-input');
    expect(section).toHaveAttribute('data-error', 'false');
  });
});
