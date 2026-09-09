import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RawDataPage } from './RawDataPage';
import type { RawTablePage } from '../../shared/types';

const sessionsPage: RawTablePage = {
  columns: ['id', 'cwd'],
  rows: [{ id: 's1', cwd: 'C:/repo-a' }],
  total: 1,
  page: 0,
  pageSize: 50,
};

const eventsPage: RawTablePage = {
  columns: ['id', 'model'],
  rows: [{ id: 1, model: 'claude-sonnet-5' }],
  total: 1,
  page: 0,
  pageSize: 50,
};

beforeEach(() => {
  window.api = {
    getFilterOptions: vi.fn(),
    getUsage: vi.fn(),
    getProjectDetail: vi.fn(),
    getRawTablePage: vi.fn().mockImplementation(({ table }: { table: string }) =>
      Promise.resolve(table === 'sessions' ? sessionsPage : eventsPage),
    ),
    getHourlyDetail: vi.fn(),
    getWeeklyActivity: vi.fn(),
  };
});

describe('RawDataPage', () => {
  it('loads and renders the sessions table by default', async () => {
    render(<RawDataPage onBack={vi.fn()} />);

    expect(await screen.findByText('s1')).toBeInTheDocument();
    expect(screen.getByText('C:/repo-a')).toBeInTheDocument();
  });

  it('switches to the usage events table when its tab is clicked', async () => {
    const user = userEvent.setup();
    render(<RawDataPage onBack={vi.fn()} />);
    await screen.findByText('s1');

    await user.click(screen.getByRole('button', { name: 'Usage events' }));

    expect(await screen.findByText('claude-sonnet-5')).toBeInTheDocument();
  });

  it('calls onBack when the back button is clicked', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<RawDataPage onBack={onBack} />);
    await screen.findByText('s1');

    await user.click(screen.getByRole('button', { name: '← Back' }));

    expect(onBack).toHaveBeenCalled();
  });
});
