import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectDetailPage } from './ProjectDetailPage';
import { createWindowApi } from '../test-utils/windowApi';
import type { AgentTraceSession, FilterOptions, ProjectDetailResult } from '../../shared/types';
import { makeAgentTraceSpan } from '../../test-utils/agent-trace-fixtures';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');

  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <actual.ResponsiveContainer width={600} height={240}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

const options: FilterOptions = {
  projects: ['org/repo-a'],
  models: ['claude-sonnet-5', 'gpt-5.4'],
  minDate: '2026-09-01',
  maxDate: '2026-09-07',
};

const detail: ProjectDetailResult = {
  project: 'org/repo-a',
  totals: { aiuCredits: 3.5, tokens: 210, requests: 3 },
  timeSeries: [{ date: '2026-09-01', aiuCredits: 3.5 }],
  conversations: [
    {
      source: 'copilot-cli',
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

const availableTraceSession: AgentTraceSession = {
  source: 'vscode',
  sessionId: 'vscode:conversation-1',
  availability: 'available',
  spans: [
    makeAgentTraceSpan({
      sessionId: 'vscode:conversation-1',
      traceId: 'trace-1',
      spanId: 'root-1',
      name: 'execute_tool readFile',
      category: 'tool',
      toolName: 'readFile',
      argumentsJson: '{"path":"README.md"}',
      resultText: 'sanitized result',
    }),
  ],
};

beforeEach(() => {
  window.api = createWindowApi({
    getFilterOptions: vi.fn(),
    getUsage: vi.fn(),
    getProjectDetail: vi.fn().mockResolvedValue(detail),
    getRawTablePage: vi.fn(),
    getHourlyDetail: vi.fn(),
    getMonthlyActivity: vi.fn(),
  });
});

describe('ProjectDetailPage', () => {
  it('shows the project name, loads detail data, and renders totals + conversations', async () => {
    render(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{}}
        options={options}
        onFiltersChange={vi.fn()}
        onBack={vi.fn()}
        onViewTrace={vi.fn()}
        traceSelection={null}
        onBackFromTrace={vi.fn()}
      />,
    );

    expect(screen.getByText('org/repo-a')).toBeInTheDocument();
    expect(await screen.findByText('3.50')).toBeInTheDocument();
    expect(screen.getByText('Fixed the login bug')).toBeInTheDocument();
  });

  it('renders a daily credit consumption chart', async () => {
    render(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{}}
        options={options}
        onFiltersChange={vi.fn()}
        onBack={vi.fn()}
        onViewTrace={vi.fn()}
        traceSelection={null}
        onBackFromTrace={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('time-series-chart')).toBeInTheDocument();
    expect(screen.getByText('Credits over time')).toBeInTheDocument();
  });

  it('renders only the model filter, placed below the back button/title row', () => {
    const { container } = render(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{}}
        options={options}
        onFiltersChange={vi.fn()}
        onBack={vi.fn()}
        onViewTrace={vi.fn()}
        traceSelection={null}
        onBackFromTrace={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Project')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toBeInTheDocument();

    const page = container.querySelector('.project-detail-page') as HTMLElement;
    const backButton = screen.getByRole('button', { name: /back/i });
    const filterBar = page.querySelector('.filter-bar') as HTMLElement;
    expect(backButton.compareDocumentPosition(filterBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('calls onFiltersChange with the updated model when a model is selected', async () => {
    const onFiltersChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{}}
        options={options}
        onFiltersChange={onFiltersChange}
        onBack={vi.fn()}
        onViewTrace={vi.fn()}
        traceSelection={null}
        onBackFromTrace={vi.fn()}
      />,
    );
    await screen.findByText('3.50');

    await user.selectOptions(screen.getByLabelText('Model'), 'gpt-5.4');

    expect(onFiltersChange).toHaveBeenCalledWith({ model: 'gpt-5.4' });
  });

  it('calls onBack when the back button is clicked', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{}}
        options={options}
        onFiltersChange={vi.fn()}
        onBack={onBack}
        onViewTrace={vi.fn()}
        traceSelection={null}
        onBackFromTrace={vi.fn()}
      />,
    );
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

    render(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{}}
        options={options}
        onFiltersChange={vi.fn()}
        onBack={vi.fn()}
        onViewTrace={vi.fn()}
        traceSelection={null}
        onBackFromTrace={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('status', { name: 'Loading' }).length).toBeGreaterThan(0);

    resolveDetail(detail);
    expect(await screen.findByText('3.50')).toBeInTheDocument();
  });

  it('shows an error message when the fetch fails and no data has loaded', async () => {
    window.api.getProjectDetail = vi.fn().mockRejectedValue(new Error('db not found'));

    render(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{}}
        options={options}
        onFiltersChange={vi.fn()}
        onBack={vi.fn()}
        onViewTrace={vi.fn()}
        traceSelection={null}
        onBackFromTrace={vi.fn()}
      />,
    );

    expect(await screen.findByText("Couldn't load details for this project.")).toBeInTheDocument();
  });

  it('shows a refresh notice while keeping stale data visible when a refetch fails', async () => {
    window.api.getProjectDetail = vi
      .fn()
      .mockResolvedValueOnce(detail)
      .mockRejectedValueOnce(new Error('refresh failed'));

    const { rerender } = render(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{ model: 'claude-sonnet-5' }}
        options={options}
        onFiltersChange={vi.fn()}
        onBack={vi.fn()}
        onViewTrace={vi.fn()}
        traceSelection={null}
        onBackFromTrace={vi.fn()}
      />,
    );

    expect(await screen.findByText('3.50')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(screen.getByText('Fixed the login bug')).toBeInTheDocument();

    rerender(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{ model: 'gpt-5.4' }}
        options={options}
        onFiltersChange={vi.fn()}
        onBack={vi.fn()}
        onViewTrace={vi.fn()}
        traceSelection={null}
        onBackFromTrace={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("Couldn't refresh — showing last known data."),
    ).toBeInTheDocument();
    expect(screen.getByText('3.50')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(screen.getByText('Fixed the login bug')).toBeInTheDocument();
  });

  it('does not animate a credit delta when a filter change starts a new update context', async () => {
    window.api.getProjectDetail = vi
      .fn()
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({
        ...detail,
        totals: { aiuCredits: 9, tokens: 400, requests: 5 },
      });

    const { rerender } = render(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{}}
        options={options}
        onFiltersChange={vi.fn()}
        onBack={vi.fn()}
        onViewTrace={vi.fn()}
        traceSelection={null}
        onBackFromTrace={vi.fn()}
      />,
    );

    expect(await screen.findByText('3.50')).toBeInTheDocument();

    rerender(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{ model: 'gpt-5.4' }}
        options={options}
        onFiltersChange={vi.fn()}
        onBack={vi.fn()}
        onViewTrace={vi.fn()}
      />,
    );

    expect(await screen.findByText('9.00')).toBeInTheDocument();
    expect(screen.queryByText('+5.50')).not.toBeInTheDocument();
  });

  it('forwards the selected conversation trace action to the parent callback', async () => {
    const onViewTrace = vi.fn();
    const user = userEvent.setup();

    render(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{}}
        options={options}
        onFiltersChange={vi.fn()}
        onBack={vi.fn()}
        onViewTrace={onViewTrace}
        traceSelection={null}
        onBackFromTrace={vi.fn()}
      />,
    );

    await screen.findByText('Fixed the login bug');
    await user.click(screen.getByRole('button', { name: /^Voir la trace : Fixed the login bug/ }));

    expect(onViewTrace).toHaveBeenCalledWith({
      source: 'copilot-cli',
      sessionId: 's1',
    });
  });

  it('replaces the project content with the trace subview and returns through onBackFromTrace without refetching detail', async () => {
    window.api.getAgentTraceSession = vi.fn().mockResolvedValue(availableTraceSession);
    const onBackFromTrace = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{}}
        options={options}
        onFiltersChange={vi.fn()}
        onBack={vi.fn()}
        onViewTrace={vi.fn()}
        traceSelection={null}
        onBackFromTrace={onBackFromTrace}
      />,
    );

    expect(await screen.findByText('Fixed the login bug')).toBeInTheDocument();
    expect(window.api.getProjectDetail).toHaveBeenCalledTimes(1);

    rerender(
      <ProjectDetailPage
        project="org/repo-a"
        filters={{}}
        options={options}
        onFiltersChange={vi.fn()}
        onBack={vi.fn()}
        onViewTrace={vi.fn()}
        traceSelection={{ source: 'vscode', sessionId: 'vscode:conversation-1' }}
        onBackFromTrace={onBackFromTrace}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Retour au projet' })).toBeInTheDocument();
    expect(screen.queryByText('Fixed the login bug')).not.toBeInTheDocument();
    expect(screen.getByText('Agent trace spans')).toBeInTheDocument();
    expect(window.api.getProjectDetail).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Retour au projet' }));

    expect(onBackFromTrace).toHaveBeenCalledTimes(1);
  });
});
