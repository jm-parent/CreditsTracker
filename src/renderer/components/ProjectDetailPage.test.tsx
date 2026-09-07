import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectDetailPage } from './ProjectDetailPage';
import type { ProjectDetailResult } from '../../shared/types';

const detail: ProjectDetailResult = {
  project: 'org/repo-a',
  totals: { aiuCredits: 3.5, tokens: 210, requests: 3 },
  conversations: [
    {
      sessionId: 's1',
      createdAt: '2026-09-01 10:00:00',
      summary: 'Fixed the login bug',
      models: 'claude-sonnet-5',
      aiuCredits: 3,
      tokens: 180,
      requests: 2,
    },
  ],
};

beforeEach(() => {
  window.api = {
    getFilterOptions: vi.fn(),
    getUsage: vi.fn(),
    getProjectDetail: vi.fn().mockResolvedValue(detail),
    getRawTablePage: vi.fn(),
  };
});

describe('ProjectDetailPage', () => {
  it('shows the project name, loads detail data, and renders totals + conversations', async () => {
    render(<ProjectDetailPage project="org/repo-a" filters={{}} onBack={vi.fn()} />);

    expect(screen.getByText('org/repo-a')).toBeInTheDocument();
    expect(await screen.findByText('3.50')).toBeInTheDocument();
    expect(screen.getByText('Fixed the login bug')).toBeInTheDocument();
  });

  it('calls onBack when the back button is clicked', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<ProjectDetailPage project="org/repo-a" filters={{}} onBack={onBack} />);
    await screen.findByText('3.50');

    await user.click(screen.getByRole('button', { name: /back/i }));

    expect(onBack).toHaveBeenCalled();
  });

  it('shows a loading skeleton before the first successful fetch', async () => {
    let resolveDetail: (value: ProjectDetailResult) => void = () => {};
    window.api.getProjectDetail = vi.fn().mockImplementation(
      () =>
        new Promise<ProjectDetailResult>((resolve) => {
          resolveDetail = resolve;
        }),
    );

    render(<ProjectDetailPage project="org/repo-a" filters={{}} onBack={vi.fn()} />);

    expect(screen.getAllByRole('status', { name: 'Loading' }).length).toBeGreaterThan(0);

    resolveDetail(detail);
    expect(await screen.findByText('3.50')).toBeInTheDocument();
  });

  it('shows an error message when the fetch fails and no data has loaded', async () => {
    window.api.getProjectDetail = vi.fn().mockRejectedValue(new Error('db not found'));

    render(<ProjectDetailPage project="org/repo-a" filters={{}} onBack={vi.fn()} />);

    expect(await screen.findByText("Couldn't load details for this project.")).toBeInTheDocument();
  });

  it('shows a refresh notice while keeping stale data visible when a refetch fails', async () => {
    window.api.getProjectDetail = vi
      .fn()
      .mockResolvedValueOnce(detail)
      .mockRejectedValueOnce(new Error('refresh failed'));

    const { rerender } = render(
      <ProjectDetailPage project="org/repo-a" filters={{ from: '2026-09-01' }} onBack={vi.fn()} />,
    );

    expect(await screen.findByText('3.50')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(screen.getByText('Fixed the login bug')).toBeInTheDocument();

    rerender(
      <ProjectDetailPage project="org/repo-a" filters={{ from: '2026-09-02' }} onBack={vi.fn()} />,
    );

    expect(
      await screen.findByText("Couldn't refresh — showing last known data."),
    ).toBeInTheDocument();
    expect(screen.getByText('3.50')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(screen.getByText('Fixed the login bug')).toBeInTheDocument();
  });
});
