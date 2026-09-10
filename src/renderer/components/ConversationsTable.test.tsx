import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ConversationsTable } from './ConversationsTable';
import type { ConversationSummary } from '../../shared/types';

const conversations: ConversationSummary[] = [
  {
    sessionId: 's1',
    createdAt: '2026-09-01 10:00:00',
    summary: 'Fixed the login bug',
    models: 'claude-sonnet-5',
    aiuCredits: 3,
    tokens: 180,
    requests: 2,
  },
  {
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
    render(<ConversationsTable conversations={[]} updateContextKey="all" />);

    expect(screen.getByText('No conversations for this selection.')).toBeInTheDocument();
  });

  it('renders one row per conversation with its fields', () => {
    render(<ConversationsTable conversations={conversations} updateContextKey="all" />);

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
      <ConversationsTable conversations={conversations} updateContextKey="all" />,
    );

    const updated: ConversationSummary[] = [
      { ...conversations[0], aiuCredits: 4.5 }, // s1: was 3, now 4.5
      { ...conversations[1], aiuCredits: 0.5 }, // s2: unchanged
    ];
    rerender(<ConversationsTable conversations={updated} updateContextKey="all" />);

    const s1Row = screen.getByText('2026-09-01 10:00:00').closest('tr') as HTMLElement;
    const s2Row = screen.getByText('2026-09-03 10:00:00').closest('tr') as HTMLElement;
    expect(within(s1Row).getByText('+1.50')).toBeInTheDocument();
    expect(within(s2Row).queryByText(/^[+−]/)).not.toBeInTheDocument();
  });

  it('clears deltas when the update context key changes', () => {
    const { rerender } = render(
      <ConversationsTable conversations={conversations} updateContextKey="all" />,
    );

    const updated: ConversationSummary[] = [
      { ...conversations[0], aiuCredits: 4.5 },
      conversations[1],
    ];
    rerender(<ConversationsTable conversations={updated} updateContextKey="project" />);

    const s1Row = screen.getByText('2026-09-01 10:00:00').closest('tr') as HTMLElement;
    expect(within(s1Row).queryByText(/^[+−]/)).not.toBeInTheDocument();
  });
});
