import path from 'node:path';
import type { ExportSessionRow, ExportSummaryRow } from '../shared/types';

export const SUMMARY_HEADERS: readonly string[] = [
  'date',
  'project',
  'model',
  'aiu_credits',
  'input_tokens',
  'output_tokens',
  'tokens',
  'requests',
  'day_total_aiu_credits',
  'model_total_aiu_credits',
  'model_share_percent',
  'project_total_aiu_credits',
  'project_share_percent',
];

export const SESSION_HEADERS: readonly string[] = [
  'session_id',
  'created_at',
  'date',
  'project',
  'summary',
  'models',
  'aiu_credits',
  'input_tokens',
  'output_tokens',
  'tokens',
  'requests',
];

const CSV_DELIMITER = ';';
const CSV_ROW_SEPARATOR = '\r\n';
const CSV_BOM = '\uFEFF';

function formatNumber(value: number): string {
  return value.toFixed(9).replace(/\.?0+$/, '');
}

function formatPercent(value: number): string {
  return value.toFixed(2);
}

function stringifyField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : formatNumber(value);
  }
  return String(value);
}

function escapeField(value: unknown): string {
  const field = stringifyField(value);
  const escaped = field.replace(/"/g, '""');
  return /[;"\r\n]/.test(field) ? `"${escaped}"` : escaped;
}

export function serializeCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  const lines = [
    headers.map(escapeField).join(CSV_DELIMITER),
    ...rows.map((row) => row.map(escapeField).join(CSV_DELIMITER)),
  ];
  return `${CSV_BOM}${lines.join(CSV_ROW_SEPARATOR)}${CSV_ROW_SEPARATOR}`;
}

function summaryRowToFields(row: ExportSummaryRow): readonly unknown[] {
  return [
    row.date,
    row.project,
    row.model,
    row.aiuCredits,
    row.inputTokens,
    row.outputTokens,
    row.tokens,
    row.requests,
    row.dayTotalAiuCredits,
    row.modelTotalAiuCredits,
    formatPercent(row.modelSharePercent),
    row.projectTotalAiuCredits,
    formatPercent(row.projectSharePercent),
  ];
}

function sessionRowToFields(row: ExportSessionRow): readonly unknown[] {
  return [
    row.sessionId,
    row.createdAt,
    row.date,
    row.project,
    row.summary,
    row.models,
    row.aiuCredits,
    row.inputTokens,
    row.outputTokens,
    row.tokens,
    row.requests,
  ];
}

export function summaryRowsToCsv(rows: readonly ExportSummaryRow[]): string {
  return serializeCsv(SUMMARY_HEADERS, rows.map(summaryRowToFields));
}

export function sessionRowsToCsv(rows: readonly ExportSessionRow[]): string {
  return serializeCsv(SESSION_HEADERS, rows.map(sessionRowToFields));
}

export function getExportFilePaths(selectedPath: string): {
  summaryPath: string;
  sessionsPath: string;
} {
  const extension = path.extname(selectedPath);
  const directory = path.dirname(selectedPath);
  const baseName = path.basename(selectedPath, extension);
  const normalizedBaseName = extension.toLowerCase() === '.csv'
    ? baseName
    : path.basename(selectedPath);

  return {
    summaryPath: path.join(directory, `${normalizedBaseName}-summary.csv`),
    sessionsPath: path.join(directory, `${normalizedBaseName}-sessions.csv`),
  };
}
