import { describe, expect, it } from 'vitest';
import type { ExportReport, UsageFilters } from '../shared/types';
import { renderHtmlReport } from './html-report';

const FILTERS: UsageFilters = {
  from: '2026-09-01',
  to: '2026-09-16',
  project: 'org/repo-a',
  model: 'gpt-5.4',
};

const GENERATED_AT = new Date('2026-09-18T07:05:00.000Z');

const REPORT: ExportReport = {
  preview: {
    totals: {
      aiuCredits: 18,
      tokens: 900,
      requests: 12,
    },
    sessionCount: 2,
    activeDays: 2,
    byModel: [
      {
        model: 'gpt-5.4',
        aiuCredits: 10,
        sharePercent: 55.56,
      },
      {
        model: 'claude-sonnet-5',
        aiuCredits: 8,
        sharePercent: 44.44,
      },
    ],
    daily: [
      {
        date: '2026-09-15',
        aiuCredits: 7,
        tokens: 320,
        requests: 4,
      },
      {
        date: '2026-09-16',
        aiuCredits: 11,
        tokens: 580,
        requests: 8,
      },
    ],
  },
  summaryRows: [
    {
      date: '2026-09-15',
      project: 'org/repo-a',
      model: 'gpt-5.4',
      aiuCredits: 6,
      inputTokens: 180,
      outputTokens: 60,
      tokens: 240,
      requests: 3,
      dayTotalAiuCredits: 7,
      modelTotalAiuCredits: 10,
      modelSharePercent: 55.56,
      projectTotalAiuCredits: 10,
      projectSharePercent: 55.56,
    },
    {
      date: '2026-09-15',
      project: 'org/repo-b',
      model: 'claude-sonnet-5',
      aiuCredits: 1,
      inputTokens: 60,
      outputTokens: 20,
      tokens: 80,
      requests: 1,
      dayTotalAiuCredits: 7,
      modelTotalAiuCredits: 8,
      modelSharePercent: 44.44,
      projectTotalAiuCredits: 8,
      projectSharePercent: 44.44,
    },
    {
      date: '2026-09-16',
      project: 'org/repo-a',
      model: 'gpt-5.4',
      aiuCredits: 4,
      inputTokens: 200,
      outputTokens: 100,
      tokens: 300,
      requests: 4,
      dayTotalAiuCredits: 11,
      modelTotalAiuCredits: 10,
      modelSharePercent: 55.56,
      projectTotalAiuCredits: 10,
      projectSharePercent: 55.56,
    },
    {
      date: '2026-09-16',
      project: 'org/repo-b',
      model: 'claude-sonnet-5',
      aiuCredits: 7,
      inputTokens: 210,
      outputTokens: 70,
      tokens: 280,
      requests: 4,
      dayTotalAiuCredits: 11,
      modelTotalAiuCredits: 8,
      modelSharePercent: 44.44,
      projectTotalAiuCredits: 8,
      projectSharePercent: 44.44,
    },
  ],
  sessionRows: [
    {
      sessionId: 'session-1',
      createdAt: '2026-09-15 09:10:00',
      date: '2026-09-15',
      project: 'org/repo-a',
      summary: 'Safe summary',
      models: 'gpt-5.4',
      aiuCredits: 6,
      inputTokens: 180,
      outputTokens: 60,
      tokens: 240,
      requests: 3,
    },
    {
      sessionId: 'session-2',
      createdAt: '2026-09-16 14:45:00',
      date: '2026-09-16',
      project: 'org/repo-b',
      summary: 'Needs review <img src=x onerror="bad">&\nSecond line',
      models: 'claude-sonnet-5, gpt-5.4',
      aiuCredits: 12,
      inputTokens: 360,
      outputTokens: 120,
      tokens: 480,
      requests: 9,
    },
  ],
};

const EMPTY_REPORT: ExportReport = {
  preview: {
    totals: {
      aiuCredits: 0,
      tokens: 0,
      requests: 0,
    },
    sessionCount: 0,
    activeDays: 0,
    byModel: [],
    daily: [],
  },
  summaryRows: [],
  sessionRows: [],
};

const ZERO_DENOMINATOR_REPORT: ExportReport = {
  preview: {
    totals: {
      aiuCredits: 0,
      tokens: 42,
      requests: 3,
    },
    sessionCount: 1,
    activeDays: 1,
    byModel: [
      {
        model: 'gpt-5.4',
        aiuCredits: 0,
        sharePercent: 0,
      },
      {
        model: 'claude-sonnet-5',
        aiuCredits: 0,
        sharePercent: 0,
      },
    ],
    daily: [
      {
        date: '2026-09-16',
        aiuCredits: 0,
        tokens: 42,
        requests: 3,
      },
    ],
  },
  summaryRows: [
    {
      date: '2026-09-16',
      project: 'org/repo-a',
      model: 'gpt-5.4',
      aiuCredits: 0,
      inputTokens: 20,
      outputTokens: 10,
      tokens: 30,
      requests: 2,
      dayTotalAiuCredits: 0,
      modelTotalAiuCredits: 0,
      modelSharePercent: 0,
      projectTotalAiuCredits: 0,
      projectSharePercent: 0,
    },
    {
      date: '2026-09-16',
      project: 'org/repo-b',
      model: 'claude-sonnet-5',
      aiuCredits: 0,
      inputTokens: 8,
      outputTokens: 4,
      tokens: 12,
      requests: 1,
      dayTotalAiuCredits: 0,
      modelTotalAiuCredits: 0,
      modelSharePercent: 0,
      projectTotalAiuCredits: 0,
      projectSharePercent: 0,
    },
  ],
  sessionRows: [
    {
      sessionId: 'session-zero',
      createdAt: '2026-09-16 10:00:00',
      date: '2026-09-16',
      project: 'org/repo-a',
      summary: 'Zero-credit activity',
      models: 'gpt-5.4',
      aiuCredits: 0,
      inputTokens: 20,
      outputTokens: 10,
      tokens: 30,
      requests: 2,
    },
  ],
};

function render(report: ExportReport): string {
  return renderHtmlReport(report, {
    filters: FILTERS,
    generatedAt: GENERATED_AT,
  });
}

function expectSafeStandaloneHtml(html: string): void {
  expect(html).not.toContain('NaN');
  expect(html).not.toContain('Infinity');
  expect(html).not.toContain('undefined');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('http://');
  expect(html).not.toContain('https://');
}

describe('renderHtmlReport', () => {
  it('renders a standalone report with the required semantic sections', () => {
    const html = render(REPORT);

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('id="daily-consumption"');
    expect(html).toContain('id="model-breakdown"');
    expect(html).toContain('id="project-consumption"');
    expect(html).toContain('id="token-ratio"');
    expect(html).toContain('id="execution-details"');
    expect(html).toContain('<svg');
    expect(html).toContain('org/repo-a');
    expect(html).toContain('gpt-5.4');
    expect(html).toContain('Export report');
    expect(html).toMatch(/<polyline[^>]*points="[\d.,\s-]+"/);
    expectSafeStandaloneHtml(html);
  });

  it('renders input and output token columns in the execution details table', () => {
    const html = render(REPORT);

    expect(html).toContain('<th>Input tokens</th>');
    expect(html).toContain('<th>Output tokens</th>');
    expect(html).toContain(
      '<td>2026-09-15</td>\n              <td>2026-09-15 09:10:00</td>\n              <td>org/repo-a</td>\n              <td>gpt-5.4</td>\n              <td>6</td>\n              <td>180</td>\n              <td>60</td>\n              <td>240</td>\n              <td>3</td>',
    );
    expect(html).toContain(
      '<td>2026-09-16</td>\n              <td>2026-09-16 14:45:00</td>\n              <td>org/repo-b</td>\n              <td>claude-sonnet-5, gpt-5.4</td>\n              <td>12</td>\n              <td>360</td>\n              <td>120</td>\n              <td>480</td>\n              <td>9</td>',
    );
  });

  it('escapes HTML-sensitive session content', () => {
    const html = render(REPORT);

    expect(html).toContain(
      'Needs review &lt;img src=x onerror=&quot;bad&quot;&gt;&amp;\nSecond line',
    );
    expect(html).not.toContain('<img src=x onerror="bad">&');
  });

  it('renders explicit empty states for empty reports', () => {
    const html = render(EMPTY_REPORT);

    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('No usage for this selection.');
    expect(html).toContain('No data available');
    expectSafeStandaloneHtml(html);
  });

  it('keeps zero-denominator reports finite and script-free', () => {
    const html = render(ZERO_DENOMINATOR_REPORT);

    expect(html).toContain('gpt-5.4');
    expect(html).toContain('claude-sonnet-5');
    expect(html).toContain('0%');
    expectSafeStandaloneHtml(html);
  });
});
