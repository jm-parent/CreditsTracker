import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveDefaultWorkspaceStorageDir,
  parseChatSessionFile,
  loadVscodeUsage,
} from './vscode-chat-store';

function jsonl(...objs: unknown[]): string {
  return objs.map((o) => JSON.stringify(o)).join('\n') + '\n';
}

describe('resolveDefaultWorkspaceStorageDir', () => {
  it('points at a Code/User/workspaceStorage folder under the home directory', () => {
    const result = resolveDefaultWorkspaceStorageDir();
    expect(result).toContain(os.homedir());
    expect(result).toContain(path.join('Code', 'User', 'workspaceStorage'));
  });
});

describe('parseChatSessionFile', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('replays patch entries and returns one event per completed request', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-chat-'));
    const filePath = path.join(tmpDir, 'session-1.jsonl');

    const content = jsonl(
      { kind: 0, v: { sessionId: 'session-1', creationDate: 1_700_000_000_000, requests: [] } },
      { kind: 1, k: ['customTitle'], v: 'Fixing the login bug' },
      {
        kind: 2,
        k: ['requests'],
        v: [
          {
            requestId: 'req-1',
            timestamp: 1_700_000_010_000,
            modelId: 'copilot/gpt-6-astra',
            message: { text: 'Why is login failing?' },
          },
        ],
      },
      { kind: 1, k: ['requests', 0, 'promptTokens'], v: 35348 },
      { kind: 1, k: ['requests', 0, 'completionTokens'], v: 520 },
      { kind: 1, k: ['requests', 0, 'copilotCredits'], v: 52.3143 },
      {
        kind: 2,
        k: ['requests'],
        v: [{ requestId: 'req-2', timestamp: 1_700_000_020_000, modelId: 'copilot/claude-sonnet-5' }],
      },
      { kind: 1, k: ['requests', 1, 'promptTokens'], v: 100 },
      { kind: 1, k: ['requests', 1, 'completionTokens'], v: 10 },
      // req-2 has no copilotCredits yet (still in flight) and must be skipped.
    );
    fs.writeFileSync(filePath, content, 'utf-8');

    const result = parseChatSessionFile(filePath, 'C:/Devs/SomeProject');

    expect(result.events).toEqual([
      {
        sessionId: 'session-1',
        project: 'C:/Devs/SomeProject',
        model: 'gpt-6-astra',
        aiuCredits: 52.3143,
        inputTokens: 35348,
        outputTokens: 520,
        createdAt: '2023-11-14 22:13:30.000',
      },
    ]);
    expect(result.sessions).toEqual([
      {
        sessionId: 'session-1',
        project: 'C:/Devs/SomeProject',
        summary: 'Fixing the login bug',
        createdAt: '2023-11-14 22:13:20.000',
      },
    ]);
  });

  it('returns empty results for a missing or unreadable file', () => {
    const result = parseChatSessionFile('C:/does/not/exist.jsonl', null);
    expect(result).toEqual({ events: [], sessions: [] });
  });

  it('ignores malformed lines instead of throwing', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-chat-'));
    const filePath = path.join(tmpDir, 'session-2.jsonl');
    fs.writeFileSync(filePath, 'not json\n{"kind":0,"v":{"sessionId":"s"}}\n', 'utf-8');

    const result = parseChatSessionFile(filePath, null);
    expect(result).toEqual({ events: [], sessions: [] });
  });
});

describe('loadVscodeUsage', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scans workspace folders, resolves project from workspace.json, and aggregates events', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-storage-'));

    const workspaceDir = path.join(tmpDir, 'abc123');
    const chatSessionsDir = path.join(workspaceDir, 'chatSessions');
    fs.mkdirSync(chatSessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'workspace.json'),
      JSON.stringify({ folder: 'file:///c%3A/Devs/MyProject' }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(chatSessionsDir, 'session-1.jsonl'),
      jsonl(
        { kind: 0, v: { sessionId: 'session-1', creationDate: 1_700_000_000_000 } },
        {
          kind: 2,
          k: ['requests'],
          v: [{ requestId: 'req-1', timestamp: 1_700_000_010_000, modelId: 'copilot/gpt-6-astra' }],
        },
        { kind: 1, k: ['requests', 0, 'promptTokens'], v: 10 },
        { kind: 1, k: ['requests', 0, 'completionTokens'], v: 5 },
        { kind: 1, k: ['requests', 0, 'copilotCredits'], v: 1.5 },
      ),
      'utf-8',
    );

    // A sibling folder without a chatSessions directory should be skipped
    // silently rather than causing the whole scan to fail.
    fs.mkdirSync(path.join(tmpDir, 'no-chats'), { recursive: true });

    const result = loadVscodeUsage(tmpDir);

    const expectedProject = path.normalize('C:/Devs/MyProject');
    expect(result.events).toEqual([
      {
        sessionId: 'session-1',
        project: expectedProject,
        model: 'gpt-6-astra',
        aiuCredits: 1.5,
        inputTokens: 10,
        outputTokens: 5,
        createdAt: '2023-11-14 22:13:30.000',
      },
    ]);
    expect(result.sessions).toEqual([
      {
        sessionId: 'session-1',
        project: expectedProject,
        summary: null,
        createdAt: '2023-11-14 22:13:20.000',
      },
    ]);
  });

  it('returns empty results when the workspaceStorage directory does not exist', () => {
    const result = loadVscodeUsage('C:/does/not/exist/workspaceStorage');
    expect(result).toEqual({ events: [], sessions: [] });
  });

  it('resolves multi-root .code-workspace files to their base file name', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-storage-'));
    const workspaceDir = path.join(tmpDir, 'def456');
    const chatSessionsDir = path.join(workspaceDir, 'chatSessions');
    fs.mkdirSync(chatSessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'workspace.json'),
      JSON.stringify({ workspace: 'file:///c%3A/Users/me/my-project.code-workspace' }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(chatSessionsDir, 'session-1.jsonl'),
      jsonl(
        { kind: 0, v: { sessionId: 'session-1', creationDate: 1_700_000_000_000 } },
        { kind: 2, k: ['requests'], v: [{ requestId: 'req-1', timestamp: 1_700_000_010_000, modelId: 'gpt-5.4' }] },
        { kind: 1, k: ['requests', 0, 'copilotCredits'], v: 3 },
      ),
      'utf-8',
    );

    const result = loadVscodeUsage(tmpDir);
    expect(result.events[0].project).toBe('my-project');
  });
});
