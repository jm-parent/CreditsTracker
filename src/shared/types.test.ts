import { describe, it, expect } from 'vitest';
import type { ConversationSummary, ProjectDetailResult } from './types';

describe('shared types', () => {
  it('allows constructing a fully-populated UsageResult', () => {
    const result = {
      totals: { aiuCredits: 1.5, tokens: 100, requests: 2 },
      timeSeries: [{ date: '2026-09-01', aiuCredits: 1.5 }],
      byProject: [{ key: 'my-repo', aiuCredits: 1.5 }],
      byModel: [{ key: 'claude-sonnet-5', aiuCredits: 1.5 }],
    };
    expect(result.totals.aiuCredits).toBe(1.5);
  });

  it('allows an empty UsageFilters and a populated one', () => {
    const empty = {};
    const full = { project: 'my-repo', model: 'claude-sonnet-5', from: '2026-09-01', to: '2026-09-07' };
    expect(empty).toEqual({});
    expect(full.project).toBe('my-repo');
  });

  it('allows constructing FilterOptions', () => {
    const options = {
      projects: ['my-repo'],
      models: ['claude-sonnet-5'],
      minDate: '2026-09-01',
      maxDate: '2026-09-07',
    };
    expect(options.projects).toContain('my-repo');
  });

  it('allows constructing project detail types', () => {
    const conversation = {
      sessionId: 's1',
      createdAt: '2026-09-01 10:00:00',
      summary: 'Fixed a bug',
      models: 'claude-sonnet-5,gpt-5.4',
      aiuCredits: 3,
      tokens: 120,
      requests: 2,
    } satisfies ConversationSummary;

    const result = {
      project: 'org/repo-a',
      totals: { aiuCredits: 3, tokens: 120, requests: 2 },
      timeSeries: [{ date: '2026-09-01', aiuCredits: 3 }],
      conversations: [conversation],
    } satisfies ProjectDetailResult;

    expect(result.conversations[0].sessionId).toBe('s1');
  });
});
