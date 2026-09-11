import { setTimeout as delay } from 'node:timers/promises';

export interface SquirrelRceditMetadata {
  authors: string;
  copyright?: string;
  description?: string;
  iconPath?: string;
  id: string;
  setupExePath: string;
  version: string;
}

export function isRecoverableSquirrelResourceEditFailure(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message.includes('Failed to modify resources') &&
    error.message.includes('Fatal error: Unable to commit changes')
  );
}

export function buildSquirrelRceditArgs({
  authors,
  copyright,
  description,
  iconPath,
  id,
  setupExePath,
  version,
}: SquirrelRceditMetadata): string[] {
  const fileDescription = description ?? `Installer for ${id}`;
  const productName = description ?? id;

  return [
    setupExePath,
    '--set-version-string',
    'CompanyName',
    authors,
    '--set-version-string',
    'LegalCopyright',
    copyright ?? `Copyright © ${new Date().getFullYear()} ${authors}`,
    '--set-version-string',
    'FileDescription',
    fileDescription,
    '--set-version-string',
    'ProductName',
    productName,
    '--set-file-version',
    version,
    '--set-product-version',
    version,
    ...(iconPath ? ['--set-icon', iconPath] : []),
  ];
}

interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}

export async function retryRceditUntilReady<T>(
  run: () => Promise<T>,
  { attempts = 5, delayMs = 500, wait = delay }: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.includes('Unable to commit changes') || attempt === attempts) {
        throw error;
      }

      await wait(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
