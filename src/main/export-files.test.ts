import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getExportFilePath, writeExportFile } from './export-files';

const TEST_ARTIFACTS_ROOT = path.join(process.cwd(), '.test-artifacts');

function createExportTestDirectory(): string {
  const directory = path.join(
    TEST_ARTIFACTS_ROOT,
    `export-files-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

describe('getExportFilePath', () => {
  it('normalizes selected paths to one html destination', () => {
    expect(getExportFilePath('C:\\reports\\usage.html')).toBe('C:\\reports\\usage.html');
    expect(getExportFilePath('C:\\reports\\usage.csv')).toBe('C:\\reports\\usage.html');
    expect(getExportFilePath('C:\\reports\\usage')).toBe('C:\\reports\\usage.html');
  });
});

describe('writeExportFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores the original html file when publishing fails', async () => {
    const exportRoot = createExportTestDirectory();
    const destinationPath = path.join(exportRoot, 'usage.html');
    const originalRename = fsPromises.rename.bind(fsPromises);
    let renameCallCount = 0;

    fs.writeFileSync(destinationPath, 'original', 'utf8');

    vi.spyOn(fsPromises, 'rename').mockImplementation(async (from, to) => {
      renameCallCount += 1;
      if (renameCallCount === 2) {
        throw new Error('publish failed');
      }
      await originalRename(from, to);
    });

    try {
      await expect(writeExportFile(destinationPath, '<!doctype html>new')).rejects.toThrow('publish failed');
      expect(fs.readFileSync(destinationPath, 'utf8')).toBe('original');
      expect(fs.readdirSync(exportRoot)).toEqual(['usage.html']);
    } finally {
      fs.rmSync(exportRoot, { recursive: true, force: true });
    }
  });
});
