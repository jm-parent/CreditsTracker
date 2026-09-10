import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders all six navigation entries', () => {
    render(<Sidebar activeTab="daily" onTabChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Daily consumption' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Monthly activity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'By project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'By model' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raw data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logs' })).toBeInTheDocument();
  });

  it('highlights the active tab', () => {
    render(<Sidebar activeTab="projects" onTabChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'By project' }).className).toContain('bg-primary');
    expect(screen.getByRole('button', { name: 'Daily consumption' }).className).not.toContain('bg-primary');
  });

  it('calls onTabChange with the clicked tab id', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<Sidebar activeTab="daily" onTabChange={onTabChange} />);

    await user.click(screen.getByRole('button', { name: 'By model' }));

    expect(onTabChange).toHaveBeenCalledWith('models');
  });

  it('renders the packaged version footer when provided', () => {
    render(<Sidebar activeTab="daily" onTabChange={vi.fn()} appVersion="1.4.1" />);

    expect(screen.getByText('v1.4.1')).toBeInTheDocument();
  });

  it('hides the update badge when no update is actionable', () => {
    render(
      <Sidebar
        activeTab="daily"
        onTabChange={vi.fn()}
        appVersion="1.4.1"
        updateState={{ status: 'up-to-date', currentVersion: '1.4.1' }}
      />,
    );

    expect(screen.queryByRole('button', { name: /Update/ })).not.toBeInTheDocument();
  });

  it('opens the update dialog from the badge next to the version', async () => {
    const user = userEvent.setup();
    const onUpdateClick = vi.fn();
    render(
      <Sidebar
        activeTab="daily"
        onTabChange={vi.fn()}
        appVersion="1.4.1"
        updateState={{ status: 'available', currentVersion: '1.4.1', latestVersion: '1.6.0' }}
        onUpdateClick={onUpdateClick}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Update available (v1.6.0)' }));

    expect(onUpdateClick).toHaveBeenCalledTimes(1);
  });

  it('labels the badge as ready to restart once the update is staged', () => {
    render(
      <Sidebar
        activeTab="daily"
        onTabChange={vi.fn()}
        appVersion="1.4.1"
        updateState={{ status: 'ready', currentVersion: '1.4.1', latestVersion: '1.6.0' }}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Update ready — restart to apply' }),
    ).toBeInTheDocument();
  });
});
