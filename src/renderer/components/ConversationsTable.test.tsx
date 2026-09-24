import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ConversationsTable } from './ConversationsTable';
import type { ConversationSummary } from '../../shared/types';
import userEvent from '@testing-library/user-event';

const conversations: ConversationSummary[] = [
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
  {
    source: 'copilot-cli',
    sessionId: 's2',
    createdAt: '2026-09-03 10:00:00',
    summary: null,
    models: 'gpt-5.4',
    aiuCredits: 0.5,
    tokens: 35,
    requests: 1,
  },
];

describe('ConversationsTable', () => {
  it('shows an empty message when there are no conversations', () => {
    render(<ConversationsTable conversations={[]} updateContextKey="all" onViewTrace={vi.fn()} />);

    expect(screen.getByText('No conversations for this selection.')).toBeInTheDocument();
  });

  it('renders one row per conversation with its fields', () => {
    render(<ConversationsTable conversations={conversations} updateContextKey="all" onViewTrace={vi.fn()} />);

    expect(screen.getByText('Fixed the login bug')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('2026-09-01 10:00:00')).toBeInTheDocument();
    expect(screen.getByText('2026-09-03 10:00:00')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.4')).toBeInTheDocument();
    expect(screen.getByText('3.00')).toBeInTheDocument();
    expect(screen.getByText('0.50')).toBeInTheDocument();
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('35')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('tracks credit deltas by sessionId', () => {
    const { rerender } = render(
      <ConversationsTable conversations={conversations} updateContextKey="all" onViewTrace={vi.fn()} />,
    );

    const updated: ConversationSummary[] = [
      { ...conversations[0], aiuCredits: 4.5 }, // s1: was 3, now 4.5
      { ...conversations[1], aiuCredits: 0.5 }, // s2: unchanged
    ];
    rerender(<ConversationsTable conversations={updated} updateContextKey="all" onViewTrace={vi.fn()} />);

    const s1Row = screen.getByText('2026-09-01 10:00:00').closest('tr') as HTMLElement;
    const s2Row = screen.getByText('2026-09-03 10:00:00').closest('tr') as HTMLElement;
    expect(within(s1Row).getByText('+1.50')).toBeInTheDocument();
    expect(within(s2Row).queryByText(/^[+−]/)).not.toBeInTheDocument();
  });

  it('clears deltas when the update context key changes', () => {
    const { rerender } = render(
      <ConversationsTable conversations={conversations} updateContextKey="all" onViewTrace={vi.fn()} />,
    );

    const updated: ConversationSummary[] = [
      { ...conversations[0], aiuCredits: 4.5 },
      conversations[1],
    ];
    rerender(<ConversationsTable conversations={updated} updateContextKey="project" onViewTrace={vi.fn()} />);

    const s1Row = screen.getByText('2026-09-01 10:00:00').closest('tr') as HTMLElement;
    expect(within(s1Row).queryByText(/^[+−]/)).not.toBeInTheDocument();
  });

  it('forwards the selected VS Code or Copilot CLI conversation to the explicit trace action without making rows clickable', async () => {
    const onViewTrace = vi.fn();
    const user = userEvent.setup();
    const traceableConversations: ConversationSummary[] = [
      {
        source: 'vscode',
        sessionId: 'vscode:vscode-session-1',
        createdAt: '2026-09-23 10:00:00',
        summary: 'VS Code work',
        models: 'gpt-5.4',
        aiuCredits: 1,
        tokens: 10,
        requests: 1,
      },
      {
        source: 'copilot-cli',
        sessionId: 'copilot-cli:session-2',
        createdAt: '2026-09-23 11:00:00',
        summary: 'CLI work',
        models: 'claude-sonnet-5',
        aiuCredits: 2.5,
        tokens: 25,
        requests: 2,
      },
    ];

    render(
      <ConversationsTable
        conversations={traceableConversations}
        updateContextKey="all"
        onViewTrace={onViewTrace}
      />,
    );

    const vscodeRow = screen.getByText('VS Code work').closest('tr') as HTMLElement;
    const cliRow = screen.getByText('CLI work').closest('tr') as HTMLElement;

    await user.click(screen.getByText('VS Code work'));
    expect(onViewTrace).not.toHaveBeenCalled();

    await user.click(within(vscodeRow).getByRole('button', { name: 'Voir la trace' }));
    await user.click(within(cliRow).getByRole('button', { name: 'Voir la trace' }));

    expect(onViewTrace).toHaveBeenNthCalledWith(1, {
      source: 'vscode',
      sessionId: 'vscode:vscode-session-1',
    });
    expect(onViewTrace).toHaveBeenNthCalledWith(2, {
      source: 'copilot-cli',
      sessionId: 'copilot-cli:session-2',
    });
    expect(within(vscodeRow).getByText('1.00')).toBeInTheDocument();
    expect(within(cliRow).getByText('2.50')).toBeInTheDocument();
  });

  it('tracks credit deltas independently when two sources share the same session id', () => {
    const sharedIdConversations: ConversationSummary[] = [
      {
        source: 'vscode',
        sessionId: 'shared-session',
        createdAt: '2026-09-23 10:00:00',
        summary: 'VS Code work',
        models: 'gpt-5.4',
        aiuCredits: 1,
        tokens: 10,
        requests: 1,
      },
      {
        source: 'copilot-cli',
        sessionId: 'shared-session',
        createdAt: '2026-09-23 11:00:00',
        summary: 'CLI work',
        models: 'claude-sonnet-5',
        aiuCredits: 2,
        tokens: 20,
        requests: 2,
      },
    ];

    const { rerender } = render(
      <ConversationsTable
        conversations={sharedIdConversations}
        updateContextKey="all"
        onViewTrace={vi.fn()}
      />,
    );

    rerender(
      <ConversationsTable
        conversations={[
          { ...sharedIdConversations[0], aiuCredits: 1.75 },
          sharedIdConversations[1],
        ]}
        updateContextKey="all"
        onViewTrace={vi.fn()}
      />,
    );

    const vscodeRow = screen.getByText('VS Code work').closest('tr') as HTMLElement;
    const cliRow = screen.getByText('CLI work').closest('tr') as HTMLElement;
    expect(within(vscodeRow).getByText('+0.75')).toBeInTheDocument();
    expect(within(cliRow).queryByText(/^[+−]/)).not.toBeInTheDocument();
  });
});
