import fs from 'node:fs/promises';
import path from 'node:path';

interface ExportTarget {
  destinationPath: string;
  stagedPath: string;
  backupPath: string;
  contents: string;
  backupCreated: boolean;
  published: boolean;
}

function createTempToken(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createTarget(destinationPath: string, contents: string, token: string): ExportTarget {
  const directory = path.dirname(destinationPath);
  const fileName = path.basename(destinationPath);

  return {
    destinationPath,
    stagedPath: path.join(directory, `${fileName}.${token}.staged`),
    backupPath: path.join(directory, `${fileName}.${token}.backup`),
    contents,
    backupCreated: false,
    published: false,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function removeFileIfPresent(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === 'string' ? error : 'Unknown export write failure');
}

async function cleanupTemporaryFiles(
  targets: readonly ExportTarget[],
  options: { includeBackups: boolean },
): Promise<unknown[]> {
  const errors: unknown[] = [];

  for (const target of targets) {
    for (const filePath of [
      target.stagedPath,
      ...(options.includeBackups ? [target.backupPath] : []),
    ]) {
      try {
        await removeFileIfPresent(filePath);
      } catch (error) {
        errors.push(error);
      }
    }
  }

  return errors;
}

async function rollbackPublishedFiles(targets: readonly ExportTarget[]): Promise<unknown[]> {
  const errors: unknown[] = [];
  let backupRestoreFailed = false;

  for (const target of [...targets].reverse()) {
    if (!target.published) {
      continue;
    }
    try {
      await removeFileIfPresent(target.destinationPath);
    } catch (error) {
      errors.push(error);
    }
  }

  for (const target of [...targets].reverse()) {
    if (!target.backupCreated) {
      continue;
    }
    try {
      await fs.rename(target.backupPath, target.destinationPath);
      target.backupCreated = false;
    } catch (error) {
      backupRestoreFailed = true;
      errors.push(error);
    }
  }

  return errors.concat(
    await cleanupTemporaryFiles(targets, {
      includeBackups: !backupRestoreFailed,
    }),
  );
}

function toCombinedError(originalError: unknown, followupErrors: readonly unknown[]): Error {
  const rootError = asError(originalError);
  if (followupErrors.length === 0) {
    return rootError;
  }

  return new AggregateError(
    [rootError, ...followupErrors.map(asError)],
    `Failed to publish export files: ${rootError.message}. Rollback also failed.`,
  );
}

export function getExportFilePath(selectedPath: string): string {
  const extension = path.extname(selectedPath);
  if (
    extension.toLowerCase() !== '.html' &&
    extension.toLowerCase() !== '.htm' &&
    extension.toLowerCase() !== '.csv'
  ) {
    return `${selectedPath}.html`;
  }

  return path.join(
    path.dirname(selectedPath),
    `${path.basename(selectedPath, extension)}.html`,
  );
}

export async function writeExportFile(
  destinationPath: string,
  contents: string,
): Promise<void> {
  const token = createTempToken();
  const targets = [createTarget(destinationPath, contents, token)];

  try {
    await Promise.all(targets.map((target) => fs.writeFile(target.stagedPath, target.contents, 'utf8')));

    for (const target of targets) {
      if (await pathExists(target.destinationPath)) {
        await fs.rename(target.destinationPath, target.backupPath);
        target.backupCreated = true;
      }

      await fs.rename(target.stagedPath, target.destinationPath);
      target.published = true;
    }
  } catch (error) {
    throw toCombinedError(error, await rollbackPublishedFiles(targets));
  }

  const cleanupErrors = await cleanupTemporaryFiles(targets, { includeBackups: true });
  if (cleanupErrors.length > 0) {
    throw toCombinedError(cleanupErrors[0], cleanupErrors.slice(1));
  }
}
