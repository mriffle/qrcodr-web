import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/App';

/**
 * Focus management for the telemetry picker popovers (shape + icon rows).
 * Escape and option selection unmount the focused node inside the menu; the
 * hook must hand focus back to the trigger or keyboard users get stranded on
 * <body>. (Outside-click dismissal intentionally does NOT refocus — focus
 * belongs wherever the user clicked.)
 */
describe('picker menus · focus management', () => {
  test('Escape closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = screen.getByTestId('module-shape-trigger');
    await user.click(trigger);
    expect(screen.getByTestId('module-shape-rounded')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('module-shape-rounded')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test('selecting an option closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = screen.getByTestId('center-icon-trigger');
    await user.click(trigger);
    await user.click(screen.getByTestId('center-icon-option-heart'));
    expect(screen.queryByTestId('center-icon-option-heart')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
