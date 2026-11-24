// Runs the TypeScript VS Code chat import against the synthetic chat logs under fixtures/vscode/ and
// records what each call returned. The output is the fixture `rust/vscode_chat/tests/fixtures/scenarios.json`,
// which the Rust port replays. The rust-anything recorder runs each case from a temporary folder, so
// fixture paths cannot be recorded through it; this script resolves them against the repository root.
// Usage: node reference/dist/scenarios/scenarios/vscode-chat-scenarios.js <output path> <repo root>

import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadVscodeUsage, parseChatSessionFile, resolveDefaultWorkspaceStorageDir } from '../src/vscode-chat-store';

const FIXTURE_ROOT = 'fixtures/vscode/workspaceStorage';

type Case =
  | { name: string; call: 'parseChatSessionFile'; file: string; project: string | null }
  | { name: string; call: 'loadVscodeUsage'; dir: string }
  | { name: string; call: 'resolveDefaultWorkspaceStorageDir' };

type Outcome = { ok: unknown } | { threw: string };

const CASES: Case[] = [
  {
    name: 'session-with-lowercase-drive-folder',
    call: 'parseChatSessionFile',
    file: `${FIXTURE_ROOT}/alpha-workspace/chatSessions/session-001.jsonl`,
    project: 'C:\\repos\\alpha',
  },
  {
    name: 'non-ascii-project-and-emoji-title',
    call: 'parseChatSessionFile',
    file: `${FIXTURE_ROOT}/cafe-workspace/chatSessions/session-002.jsonl`,
    project: 'Projet café 🚀',
  },
  {
    name: 'multi-root-patches-and-malformed-lines',
    call: 'parseChatSessionFile',
    file: `${FIXTURE_ROOT}/multi-root-workspace/chatSessions/session-003.jsonl`,
    project: 'café-team',
  },
  {
    name: 'no-creation-date-fallback-and-in-progress-request',
    call: 'parseChatSessionFile',
    file: `${FIXTURE_ROOT}/no-manifest-workspace/chatSessions/session-005.jsonl`,
    project: null,
  },
  {
    name: 'null-line-throws',
    call: 'parseChatSessionFile',
    file: `${FIXTURE_ROOT}/broken-workspace/chatSessions/session-007.jsonl`,
    project: 'app',
  },
  {
    name: 'lone-surrogate-escapes-keep-credits',
    call: 'parseChatSessionFile',
    file: `${FIXTURE_ROOT}/truncated-prompt-workspace/chatSessions/session-008.jsonl`,
    project: 'app',
  },
  {
    name: 'missing-session-file-is-empty',
    call: 'parseChatSessionFile',
    file: `${FIXTURE_ROOT}/does-not-exist/chatSessions/session-404.jsonl`,
    project: null,
  },
  { name: 'whole-storage-tree', call: 'loadVscodeUsage', dir: FIXTURE_ROOT },
  { name: 'broken-workspace-alone-is-skipped', call: 'loadVscodeUsage', dir: `${FIXTURE_ROOT}/broken-workspace` },
  { name: 'missing-storage-dir-is-empty', call: 'loadVscodeUsage', dir: `${FIXTURE_ROOT}/no-such-storage` },
  { name: 'default-storage-dir', call: 'resolveDefaultWorkspaceStorageDir' },
];

function attempt(run: () => unknown): Outcome {
  try {
    return { ok: run() };
  } catch (error) {
    return { threw: error instanceof Error ? error.name : 'non-Error' };
  }
}

// Only the path below the home folder is recorded, so the fixture does not depend on the recording machine's user name.
function runCase(scenario: Case, repoRoot: string): unknown {
  switch (scenario.call) {
    case 'parseChatSessionFile':
      return {
        ...scenario,
        outcome: attempt(() => parseChatSessionFile(path.join(repoRoot, scenario.file), scenario.project)),
      };
    case 'loadVscodeUsage':
      return { ...scenario, outcome: attempt(() => loadVscodeUsage(path.join(repoRoot, scenario.dir))) };
    case 'resolveDefaultWorkspaceStorageDir': {
      const outcome = attempt(() => path.relative(os.homedir(), resolveDefaultWorkspaceStorageDir()));
      return { ...scenario, outcome };
    }
  }
}

const [outputPath, repoRoot] = process.argv.slice(2);
if (!outputPath || !repoRoot) {
  console.error('usage: node vscode-chat-scenarios.js <output path> <repo root>');
  process.exit(2);
}

writeFileSync(outputPath, `${JSON.stringify(CASES.map((scenario) => runCase(scenario, repoRoot)), null, 2)}\n`);
