import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateDialog } from './UpdateDialog';
import type { UpdateState } from '../../shared/types';

function renderDialog(state: Partial<UpdateState>, handlers: Partial<{
  onDownload: () => void;
  onRestart: () => void;
  onClose: () => void;
}> = {}) {
  const props = {
    onDownload: vi.fn(),
    onRestart: vi.fn(),
    onClose: vi.fn(),
    ...handlers,
  };
  render(
    <UpdateDialog
      state={{ status: 'available', currentVersion: '1.5.0', ...state } as UpdateState}
      onDownload={props.onDownload}
      onRestart={props.onRestart}
      onClose={props.onClose}
    />,
  );
  return props;
}

describe('UpdateDialog', () => {
  it('lets the user start the download for an available update', async () => {
    const { onDownload } = renderDialog({ latestVersion: '1.6.0', releaseNotes: 'New badge' });

    expect(screen.getByText(/v1.6.0 is available/)).toBeInTheDocument();
    expect(screen.getByText('New badge')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Download and install' }));

    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('shows the in-progress state and disables the download button', () => {
    renderDialog({ status: 'downloading', latestVersion: '1.6.0' });

    expect(screen.getByText('Downloading and installing the update…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Downloading/ })).toBeDisabled();
  });

  it('asks for a restart once the update is staged', async () => {
    const { onRestart } = renderDialog({ status: 'ready', latestVersion: '1.6.0' });

    expect(screen.getByText(/Restart the app to switch to the new version/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));

    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('reports a failed update and offers a retry', () => {
    renderDialog({ status: 'error', error: 'no RELEASES file' });

    expect(screen.getByText(/no RELEASES file/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});
