import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DesktopShortcutDialog } from './DesktopShortcutDialog';

describe('DesktopShortcutDialog', () => {
  it('lets the user create the shortcut', async () => {
    const onCreate = vi.fn();
    const onDismiss = vi.fn();
    render(<DesktopShortcutDialog creating={false} onCreate={onCreate} onDismiss={onDismiss} />);

    expect(screen.getByText('Create a Desktop shortcut?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create shortcut' }));

    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('lets the user decline', async () => {
    const onCreate = vi.fn();
    const onDismiss = vi.fn();
    render(<DesktopShortcutDialog creating={false} onCreate={onCreate} onDismiss={onDismiss} />);

    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('disables the create button while creating', () => {
    render(<DesktopShortcutDialog creating onCreate={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  });
});
