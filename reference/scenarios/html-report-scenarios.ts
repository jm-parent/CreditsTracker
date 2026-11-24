// Renders synthetic export reports with `reference/src/html-report.ts` and writes each input with its exact HTML,
// which the Rust port replays byte for byte in `rust/html_report/tests/scenarios.rs`.
// The output is the fixture `rust/html_report/tests/fixtures/scenarios.json`.
// Usage: node reference/dist/scenarios/scenarios/html-report-scenarios.js <output path>

import { writeFileSync } from 'node:fs';
import { renderHtmlReport } from '../src/html-report';
import type {
  ExportDailyPreviewRow,
  ExportReport,
  ExportSessionRow,
  ExportSummaryRow,
  UsageFilters,
} from '../src/shared/types';

const NO_PERIOD: UsageFilters = {};
// The TS types dates as strings, but `db.ts` reads `created_at` as nullable: a null reaches `escapeHtml` and throws.
const NULL_DATE = null as unknown as string;
const GENERATED_AT_MS = 1700000000000;
const MODELS = ['gpt-5.4', 'claude-sonnet-5', 'gpt-5.3-codex', 'claude-haiku-5.5', 'gemini-3.8-flash', 'grok-4.6', 'kimi-k3'];
const PROJECTS = ['C:/repos/alpha', 'C:/repos/beta & co'];
const DAYS = ['2026-01-01', '2026-01-02', '2026-01-03'];

type Totals = ExportReport['preview']['totals'];

function summaryRow(
  date: string,
  project: string,
  model: string,
  aiuCredits: number,
  inputTokens: number,
  outputTokens: number,
  requests: number,
): ExportSummaryRow {
  return {
    date,
    project,
    model,
    aiuCredits,
    inputTokens,
    outputTokens,
    tokens: inputTokens + outputTokens,
    requests,
    dayTotalAiuCredits: aiuCredits,
    modelTotalAiuCredits: aiuCredits,
    modelSharePercent: 0,
    projectTotalAiuCredits: aiuCredits,
    projectSharePercent: 0,
  };
}

function sessionRow(
  sessionId: string,
  createdAt: string,
  date: string,
  project: string,
  summary: string,
  models: string,
  aiuCredits: number,
  inputTokens: number,
  outputTokens: number,
  requests: number,
): ExportSessionRow {
  return {
    sessionId,
    createdAt,
    date,
    project,
    summary,
    models,
    aiuCredits,
    inputTokens,
    outputTokens,
    tokens: inputTokens + outputTokens,
    requests,
  };
}

// The preview totals, daily rows and session count are derived from the summary rows, as the export does.
function reportFrom(summaryRows: ExportSummaryRow[], sessionRows: ExportSessionRow[]): ExportReport {
  const totals: Totals = { aiuCredits: 0, tokens: 0, requests: 0 };
  const daily = new Map<string, ExportDailyPreviewRow>();
  for (const row of summaryRows) {
    totals.aiuCredits += row.aiuCredits;
    totals.tokens += row.tokens;
    totals.requests += row.requests;
    const day = daily.get(row.date) ?? { date: row.date, aiuCredits: 0, tokens: 0, requests: 0 };
    day.aiuCredits += row.aiuCredits;
    day.tokens += row.tokens;
    day.requests += row.requests;
    daily.set(row.date, day);
  }
  return {
    preview: {
      totals,
      sessionCount: sessionRows.length,
      activeDays: daily.size,
      byModel: [],
      daily: [...daily.values()],
    },
    summaryRows,
    sessionRows,
  };
}

function typicalRows(): ExportSummaryRow[] {
  const rows: ExportSummaryRow[] = [];
  DAYS.forEach((date, day) => {
    MODELS.forEach((model, m) => {
      rows.push(
        summaryRow(
          date,
          PROJECTS[m % PROJECTS.length],
          model,
          (m + 1) * 0.37 + day * 1.5,
          1000 + 137 * m,
          300 + 41 * m,
          m + 1,
        ),
      );
    });
  });
  return rows;
}

function typicalSessions(): ExportSessionRow[] {
  return [
    sessionRow('s-1', '2026-01-01 09:00:00.000', '2026-01-01', PROJECTS[0], 'Refactor parser', 'gpt-5.4', 2.5, 1200, 340, 3),
    sessionRow('s-2', '2026-01-02 14:30:00.000', '2026-01-02', PROJECTS[1], 'Line one\nLine two', 'claude-sonnet-5, kimi-k3', 4.1, 9000, 2100, 12),
    sessionRow('s-3', '2026-01-03 08:15:00.000', '2026-01-03', PROJECTS[0], '', 'grok-4.6', 0.2, 50, 10, 1),
  ];
}

// `generatedAt` is epoch milliseconds here; the renderer receives it as a Date.
const CASES: Array<{ name: string; options: { filters: UsageFilters; generatedAt: number }; report: ExportReport }> = [
  {
    name: 'typical-three-days-seven-models',
    options: { filters: { ...NO_PERIOD, from: '2026-01-01', to: '2026-01-31' }, generatedAt: GENERATED_AT_MS },
    report: reportFrom(typicalRows(), typicalSessions()),
  },
  {
    name: 'empty-selection',
    options: { filters: NO_PERIOD, generatedAt: 0 },
    report: reportFrom([], []),
  },
  {
    name: 'escaping-and-empty-filter-strings',
    options: {
      // An empty `from` is falsy, so only `to` shows; an empty project is not nullish, so it shows as is.
      filters: { ...NO_PERIOD, project: '', model: 'gpt "x"', from: '', to: '2026-02-01' },
      generatedAt: GENERATED_AT_MS,
    },
    report: reportFrom(
      [
        summaryRow('2026-02-01', '<Alpha> & "Café" \'x\' 😀', 'gpt-<5>&"x"', 3.25, 400, 90, 2),
        summaryRow('2026-02-01', "Zoë's <b>bold</b>", 'modèle ✓', 1.5, 120, 30, 1),
        summaryRow('2026-02-01', '', 'modèle ✓', 0.5, 10, 5, 1),
      ],
      [
        sessionRow(
          's-esc',
          '2026-02-01 10:00:00.000',
          '2026-02-01',
          '<Alpha> & "Café" \'x\' 😀',
          'line one\n<b>two</b>\r\nthree 😀 & "quoted"',
          'gpt-<5>&"x"',
          3.25,
          400,
          90,
          2,
        ),
      ],
    ),
  },
  {
    name: 'period-from-only',
    options: { filters: { ...NO_PERIOD, from: '2026-03-01' }, generatedAt: 86400000 },
    report: reportFrom([summaryRow('2026-03-01', PROJECTS[0], 'gpt-5.4', 7.75, 2000, 500, 4)], []),
  },
  {
    name: 'period-until-only',
    options: { filters: { ...NO_PERIOD, to: '2026-03-31' }, generatedAt: 0 },
    report: reportFrom([summaryRow('2026-03-31', PROJECTS[1], 'gpt-5.4', 0.001, 5, 5, 1)], []),
  },
  {
    name: 'zero-credits-keep-tables',
    options: { filters: NO_PERIOD, generatedAt: GENERATED_AT_MS },
    report: reportFrom(
      [
        summaryRow('2026-04-01', PROJECTS[0], 'gpt-5.4', 0, 0, 0, 0),
        summaryRow('2026-04-01', PROJECTS[1], 'kimi-k3', 0, 10, 0, 1),
      ],
      [sessionRow('s-zero', '2026-04-01 00:00:00.000', '2026-04-01', PROJECTS[0], 'zero', 'gpt-5.4', 0, 0, 0, 0)],
    ),
  },
  {
    name: 'rounding-and-long-chart',
    options: { filters: { ...NO_PERIOD, project: 'C:/repos/alpha' }, generatedAt: 1700000000000 },
    report: (() => {
      const days = Array.from({ length: 33 }, (_, i) => {
        const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
        return day;
      });
      const credits = [0.125, 0.001, -0.001, 12.345, 2.5, 1234567.891, 2 ** 70];
      const rows = [
        ...credits.map((aiu, i) =>
          summaryRow(days[i], i % 2 ? 'proj-2' : 'proj-1', `model-${i}`, aiu, 0.5 * i, -0.4 * i, i + 0.5),
        ),
        // Negative token totals exercise Math.round: -2.5 rounds to -2 and -0.4 to -0.
        summaryRow(days[0], 'proj-3', 'model-neg-half', 0.25, 0, -2.5, 0.5),
        summaryRow(days[1], 'proj-3', 'model-neg-small', 0.25, 0, -0.4, 0.5),
      ];
      const report = reportFrom(rows, [sessionRow('s-r', '2026-01-01 00:00:00.000', days[0], 'proj-1', 'x', 'm', 0.125, 2.5, -0.4, 0.5)]);
      report.preview.daily = days.map((date, i) => ({ date, aiuCredits: i * 0.25, tokens: 2.5 * i, requests: i + 0.5 }));
      report.preview.totals = { aiuCredits: 1234567.891, tokens: 2.5, requests: -0.5 };
      report.preview.sessionCount = 2.5;
      report.preview.activeDays = 33;
      return report;
    })(),
  },
  {
    name: 'null-created-at-throws',
    options: { filters: NO_PERIOD, generatedAt: GENERATED_AT_MS },
    report: reportFrom(
      [summaryRow('2026-06-01', PROJECTS[0], 'gpt-5.4', 1, 10, 10, 1)],
      [sessionRow('s-null', NULL_DATE, '2026-06-01', PROJECTS[0], 'no created date', 'gpt-5.4', 1, 10, 10, 1)],
    ),
  },
  {
    // The null summary date becomes a null daily date, which the chart escapes as its axis label.
    name: 'null-daily-date-throws',
    options: { filters: NO_PERIOD, generatedAt: GENERATED_AT_MS },
    report: reportFrom([summaryRow(NULL_DATE, PROJECTS[0], 'gpt-5.4', 1, 10, 10, 1)], []),
  },
  {
    // With no credits the chart is replaced by the empty state, so the null date is never escaped.
    name: 'null-daily-date-zero-chart-renders',
    options: { filters: NO_PERIOD, generatedAt: GENERATED_AT_MS },
    report: reportFrom([summaryRow(NULL_DATE, PROJECTS[0], 'gpt-5.4', 0, 0, 0, 0)], []),
  },
  {
    name: 'locale-ties-sort-by-label',
    options: { filters: NO_PERIOD, generatedAt: GENERATED_AT_MS },
    report: reportFrom(
      ['b', 'a', 'Cafe', 'café', '😀', '1', ' x', '-y', 'Z', 'z', 'é', 'e'].map((project) =>
        summaryRow('2026-05-01', project, 'gpt-5.4', 1, 10, 10, 1),
      ),
      [],
    ),
  },
];

// A render that throws records the throw in place of `html`; the Rust port must fail on the same inputs.
const scenarios = CASES.map(({ name, options, report }) => {
  try {
    const html = renderHtmlReport(report, { filters: options.filters, generatedAt: new Date(options.generatedAt) });
    return { name, options, report, html };
  } catch (error) {
    const { name: errorName, message } = error as Error;
    return { name, options, report, throws: { name: errorName, message } };
  }
});

const [outputPath] = process.argv.slice(2);
if (!outputPath) {
  console.error('usage: node html-report-scenarios.js <output path>');
  process.exit(2);
}

writeFileSync(outputPath, `[\n${scenarios.map((scenario) => `  ${JSON.stringify(scenario)}`).join(',\n')}\n]\n`);
