import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSquirrelRceditArgs,
  isRecoverableSquirrelResourceEditFailure,
  retryRceditUntilReady,
} from './squirrelRceditRecovery';

describe('squirrelRceditRecovery', () => {
  it('recognizes the recoverable Squirrel resource-edit failure', () => {
    const error = new Error(
      "Failed with exit code: 4294967295\nOutput:\nSystem.Exception: Failed to modify resources, command invoked was: 'rcedit.exe Setup.exe ...'\nOutput was:\nFatal error: Unable to commit changes",
    );

    expect(isRecoverableSquirrelResourceEditFailure(error)).toBe(true);
    expect(isRecoverableSquirrelResourceEditFailure(new Error('boom'))).toBe(false);
  });

  it('builds the rcedit arguments Squirrel expects for Setup.exe metadata', () => {
    const setupExePath = path.resolve('out', 'make', 'squirrel.windows', 'x64', 'Setup.exe');
    const iconPath = path.resolve('assets', 'icon.ico');

    expect(
      buildSquirrelRceditArgs({
        setupExePath,
        authors: 'jm-parent',
        version: '1.9.0',
        description: 'Local dashboard for GitHub Copilot CLI credit consumption',
        id: 'credits_tracker',
        iconPath,
        copyright: 'Copyright © 2026 jm-parent',
      }),
    ).toEqual([
      setupExePath,
      '--set-version-string',
      'CompanyName',
      'jm-parent',
      '--set-version-string',
      'LegalCopyright',
      'Copyright © 2026 jm-parent',
      '--set-version-string',
      'FileDescription',
      'Local dashboard for GitHub Copilot CLI credit consumption',
      '--set-version-string',
      'ProductName',
      'Local dashboard for GitHub Copilot CLI credit consumption',
      '--set-file-version',
      '1.9.0',
      '--set-product-version',
      '1.9.0',
      '--set-icon',
      iconPath,
    ]);
  });

  it('retries the resource edit until the setup executable is ready', async () => {
    const calls: string[] = [];

    await retryRceditUntilReady(
      async () => {
        calls.push('run');
        if (calls.length === 1) {
          throw new Error('Fatal error: Unable to commit changes');
        }
      },
      {
        attempts: 2,
        delayMs: 1,
        wait: async () => {
          calls.push('wait');
        },
      },
    );

    expect(calls).toEqual(['run', 'wait', 'run']);
  });
});
