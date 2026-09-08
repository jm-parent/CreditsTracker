import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders all four navigation entries', () => {
    render(<Sidebar activeTab="daily" onTabChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Daily consumption' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'By project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'By model' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raw data' })).toBeInTheDocument();
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
});
