import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders navigation entries under their categories', () => {
    render(<Sidebar activeTab="daily" onTabChange={vi.fn()} />);

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Overview',
      'Analysis',
      'Data & tools',
      'Discovery',
    ]);

    const buttonsInGroup = (label: string) =>
      within(screen.getByRole('group', { name: label }))
        .getAllByRole('button')
        .map((button) => button.textContent ?? '');

    expect(buttonsInGroup('Overview')).toEqual([
      'Daily consumption',
      'Monthly activity',
    ]);
    expect(buttonsInGroup('Analysis')).toEqual([
      'By project',
      'By model',
    ]);
    expect(buttonsInGroup('Data & tools')).toEqual([
      'Raw data',
      'HTML export',
      'Logs',
    ]);
    expect(buttonsInGroup('Discovery')).toEqual([
      'Featured projects',
    ]);

    expect(screen.getByRole('button', { name: 'Logs' }).className).toContain('w-full');
  });

  it('highlights the active tab', () => {
    render(<Sidebar activeTab="featured" onTabChange={vi.fn()} />);

    const featuredButton = screen.getByRole('button', { name: 'Featured projects' });
    expect(featuredButton.className).toContain('bg-primary');
    expect(featuredButton).toHaveAttribute('aria-current', 'page');
    expect(featuredButton.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Daily consumption' }).className).not.toContain('bg-primary');
  });

  it('highlights the HTML export tab', () => {
    render(<Sidebar activeTab="export" onTabChange={vi.fn()} />);

    const exportButton = screen.getByRole('button', { name: 'HTML export' });

    expect(exportButton.className).toContain('bg-primary');
    expect(exportButton).toHaveAttribute('aria-current', 'page');
    expect(exportButton.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('calls onTabChange with the clicked tab id', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<Sidebar activeTab="daily" onTabChange={onTabChange} />);

    await user.click(screen.getByRole('button', { name: 'HTML export' }));

    expect(onTabChange).toHaveBeenCalledWith('export');
  });

  it('calls onTabChange with the featured tab id', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<Sidebar activeTab="daily" onTabChange={onTabChange} />);

    await user.click(screen.getByRole('button', { name: 'Featured projects' }));

    expect(onTabChange).toHaveBeenCalledWith('featured');
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
