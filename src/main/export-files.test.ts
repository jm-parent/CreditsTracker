import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExportReport } from '../shared/types';
import { writeExportFiles } from './export-files';

const TEST_ARTIFACTS_ROOT = path.join(process.cwd(), '.test-artifacts');

const REPORT: ExportReport = {
  preview: {
    totals: {
      aiuCredits: 3,
      tokens: 15,
      requests: 2,
    },
    sessionCount: 1,
    activeDays: 1,
    byModel: [
      {
        model: 'gpt-5.4',
        aiuCredits: 3,
        sharePercent: 100,
      },
    ],
    daily: [
      {
        date: '2026-09-16',
        aiuCredits: 3,
        tokens: 15,
        requests: 2,
      },
    ],
  },
  summaryRows: [
    {
      date: '2026-09-16',
      project: 'org/repo',
      model: 'gpt-5.4',
      aiuCredits: 3,
      inputTokens: 10,
      outputTokens: 5,
      tokens: 15,
      requests: 2,
      dayTotalAiuCredits: 3,
      modelTotalAiuCredits: 3,
      modelSharePercent: 100,
      projectTotalAiuCredits: 3,
      projectSharePercent: 100,
    },
  ],
  sessionRows: [
    {
      sessionId: 'session-1',
      createdAt: '2026-09-16 10:00:00',
      date: '2026-09-16',
      project: 'org/repo',
      summary: 'Export report',
      models: 'gpt-5.4',
      aiuCredits: 3,
      inputTokens: 10,
      outputTokens: 5,
      tokens: 15,
      requests: 2,
    },
  ],
};

function createExportTestDirectory(): string {
  const directory = path.join(
    TEST_ARTIFACTS_ROOT,
    `export-files-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

describe('writeExportFiles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores pre-existing files when publishing the second file fails', async () => {
    const exportRoot = createExportTestDirectory();
    const paths = {
      summaryPath: path.join(exportRoot, 'usage-summary.csv'),
      sessionsPath: path.join(exportRoot, 'usage-sessions.csv'),
    };
    const originalRename = fsPromises.rename.bind(fsPromises);
    let renameCallCount = 0;

    fs.writeFileSync(paths.summaryPath, 'original summary', 'utf8');
    fs.writeFileSync(paths.sessionsPath, 'original sessions', 'utf8');

    vi.spyOn(fsPromises, 'rename').mockImplementation(async (from, to) => {
      renameCallCount += 1;
      if (renameCallCount === 4) {
        throw new Error('publish sessions failed');
      }
      await originalRename(from, to);
    });

    try {
      await expect(writeExportFiles(paths, REPORT)).rejects.toThrow('publish sessions failed');
      expect(fs.readFileSync(paths.summaryPath, 'utf8')).toBe('original summary');
      expect(fs.readFileSync(paths.sessionsPath, 'utf8')).toBe('original sessions');
      expect(fs.readdirSync(exportRoot).sort()).toEqual([
        'usage-sessions.csv',
        'usage-summary.csv',
      ]);
    } finally {
      fs.rmSync(exportRoot, { recursive: true, force: true });
    }
  });
});
