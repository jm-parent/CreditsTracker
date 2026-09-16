import fs from 'node:fs/promises';
import type { ExportReport } from '../shared/types';
import { sessionRowsToCsv, summaryRowsToCsv } from './csv';

export interface ExportFilePaths {
  summaryPath: string;
  sessionsPath: string;
}

export async function writeExportFiles(
  paths: ExportFilePaths,
  report: ExportReport,
): Promise<{ summaryRows: number; sessionRows: number }> {
  await fs.writeFile(paths.summaryPath, summaryRowsToCsv(report.summaryRows), 'utf8');
  await fs.writeFile(paths.sessionsPath, sessionRowsToCsv(report.sessionRows), 'utf8');
  return {
    summaryRows: report.summaryRows.length,
    sessionRows: report.sessionRows.length,
  };
}
