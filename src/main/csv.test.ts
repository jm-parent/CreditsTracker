import { describe, expect, it } from 'vitest';
import {
  getExportFilePaths,
  serializeCsv,
  summaryRowsToCsv,
} from './csv';

describe('serializeCsv', () => {
  it('writes BOM, semicolon-separated values, CRLF rows, and escaped fields', () => {
    expect(serializeCsv(['name', 'value'], [['A;B', 'say "hi"\nnow']]))
      .toBe('\uFEFFname;value\r\n"A;B";"say ""hi""\nnow"\r\n');
  });
});

describe('summaryRowsToCsv', () => {
  it('maps report fields to the documented headers and stable numeric values', () => {
    const csv = summaryRowsToCsv([{
      date: '2026-09-01',
      project: 'org/repo-a',
      model: 'gpt-5.4',
      aiuCredits: 1.25,
      inputTokens: 10,
      outputTokens: 5,
      tokens: 15,
      requests: 1,
      dayTotalAiuCredits: 1.25,
      modelTotalAiuCredits: 1.25,
      modelSharePercent: 100,
      projectTotalAiuCredits: 1.25,
      projectSharePercent: 100,
    }]);

    expect(csv).toContain(
      'date;project;model;aiu_credits;input_tokens;output_tokens;tokens;requests;day_total_aiu_credits;model_total_aiu_credits;model_share_percent;project_total_aiu_credits;project_share_percent',
    );
    expect(csv).toContain('2026-09-01;org/repo-a;gpt-5.4;1.25;10;5;15;1;1.25;1.25;100.00;1.25;100.00');
  });
});

describe('getExportFilePaths', () => {
  it('strips one CSV extension and adds the two report suffixes', () => {
    expect(getExportFilePaths('C:\\reports\\usage.csv')).toEqual({
      summaryPath: 'C:\\reports\\usage-summary.csv',
      sessionsPath: 'C:\\reports\\usage-sessions.csv',
    });
  });

  it('normalizes a selected summary report back to the common export base', () => {
    expect(getExportFilePaths('C:\\reports\\usage-summary.csv')).toEqual({
      summaryPath: 'C:\\reports\\usage-summary.csv',
      sessionsPath: 'C:\\reports\\usage-sessions.csv',
    });
  });

  it('normalizes a selected sessions report back to the common export base', () => {
    expect(getExportFilePaths('C:\\reports\\usage-sessions.csv')).toEqual({
      summaryPath: 'C:\\reports\\usage-summary.csv',
      sessionsPath: 'C:\\reports\\usage-sessions.csv',
    });
  });
});
