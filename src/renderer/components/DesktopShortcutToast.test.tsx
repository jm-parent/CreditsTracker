import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DesktopShortcutToast } from './DesktopShortcutToast';

describe('DesktopShortcutToast', () => {
  it('renders the toast actions', async () => {
    const onCreate = vi.fn();
    const onDismiss = vi.fn();

    render(
      <DesktopShortcutToast
        creating={false}
        error={null}
        onCreate={onCreate}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('No Desktop shortcut found');

    await userEvent.click(screen.getByRole('button', { name: 'Create shortcut' }));
    expect(onCreate).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss shortcut reminder' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('disables the create button while creating', () => {
    render(
      <DesktopShortcutToast
        creating
        error={null}
        onCreate={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  });

  it('renders errors in an alert region', () => {
    render(
      <DesktopShortcutToast
        creating={false}
        error="Could not create the shortcut. Please try again."
        onCreate={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not create the shortcut. Please try again.');
  });
});
