import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reads Copilot Chat usage recorded by the VS Code "GitHub Copilot Chat"
 * extension, so it can be merged alongside Copilot CLI usage in the
 * dashboard. VS Code stores one append-only JSONL file per chat conversation
 * under `<workspaceStorage>/<workspace-hash>/chatSessions/<sessionId>.jsonl`.
 * Each line is either a full snapshot (`kind: 0`) or an incremental patch
 * (`kind: 1` merge / `kind: 2` replace) targeting a JSON path in `k`. This
 * module replays those patches to recover, for each completed request, the
 * token counts and `copilotCredits` cost that the extension already computed
 * — the same "credits" unit used by `total_nano_aiu / 1e9` in the CLI's
 * session-store.db.
 */

export interface VscodeUsageEvent {
  sessionId: string;
  project: string | null;
  model: string;
  aiuCredits: number;
  inputTokens: number;
  outputTokens: number;
  /** SQLite-parseable timestamp, e.g. '2026-09-07 12:04:17.100' */
  createdAt: string;
}

export interface VscodeSessionSummary {
  sessionId: string;
  project: string | null;
  summary: string | null;
  /** SQLite-parseable timestamp, e.g. '2026-09-07 12:04:17.100' */
  createdAt: string;
}

export interface VscodeUsageData {
  events: VscodeUsageEvent[];
  sessions: VscodeSessionSummary[];
}

export function resolveDefaultWorkspaceStorageDir(): string {
  const platform = process.platform;
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage');
  }
  if (platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage');
  }
  return path.join(os.homedir(), '.config', 'Code', 'User', 'workspaceStorage');
}

interface WorkspaceJson {
  folder?: string;
  workspace?: string;
}

/**
 * VS Code preserves whatever drive-letter casing was in effect when a
 * workspace was first opened (e.g. `C:\...` vs `c:\...`), which would
 * otherwise split a single project into multiple entries. Normalize to an
 * uppercase drive letter so the same folder always groups together.
 */
function normalizeDriveLetter(filePath: string): string {
  return filePath.replace(/^([a-zA-Z]):\\/, (_match, drive: string) => `${drive.toUpperCase()}:\\`);
}

function resolveWorkspaceProject(workspaceJsonPath: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf-8')) as WorkspaceJson;
    const uri = raw.folder ?? raw.workspace;
    if (!uri) return null;
    const filePath = normalizeDriveLetter(fileURLToPath(uri));
    if (raw.workspace) {
      // Multi-root workspaces point at a `.code-workspace` file rather than a
      // folder; use its base name (without extension) as the project label.
      return path.basename(filePath, path.extname(filePath));
    }
    return filePath;
  } catch {
    return null;
  }
}

function toSqliteTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('T', ' ').replace('Z', '');
}

interface ParsedRequest {
  timestamp?: number;
  modelId?: string;
  copilotCredits?: number;
  promptTokens?: number;
  completionTokens?: number;
  [key: string]: unknown;
}

/**
 * Replays the append-only patch log for a single `chatSessions/*.jsonl` file
 * and extracts one usage event per completed request (i.e. every request for
 * which the extension has recorded a `copilotCredits` cost).
 */
export function parseChatSessionFile(filePath: string, project: string | null): VscodeUsageData {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { events: [], sessions: [] };
  }

  let sessionId = path.basename(filePath, '.jsonl');
  let customTitle: string | null = null;
  let creationDate: number | null = null;
  const requests: ParsedRequest[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obj: { kind?: number; k?: unknown; v?: unknown };
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (obj.kind === 0) {
      const snapshot = obj.v as { sessionId?: string; creationDate?: number } | undefined;
      if (snapshot && typeof snapshot.sessionId === 'string') sessionId = snapshot.sessionId;
      if (snapshot && typeof snapshot.creationDate === 'number') creationDate = snapshot.creationDate;
      continue;
    }

    if (!Array.isArray(obj.k) || obj.k.length === 0) continue;
    const k = obj.k as unknown[];

    if (k.length === 1 && k[0] === 'customTitle') {
      if (typeof obj.v === 'string') customTitle = obj.v;
      continue;
    }

    if (k[0] !== 'requests') continue;

    if (k.length === 1) {
      // A new request (or batch of requests) was appended to the array.
      if (Array.isArray(obj.v)) {
        for (const item of obj.v as ParsedRequest[]) requests.push(item);
      }
      continue;
    }

    const index = Number(k[1]);
    if (!Number.isInteger(index) || index < 0) continue;
    while (requests.length <= index) requests.push({});

    if (k.length === 2) {
      Object.assign(requests[index], obj.v as ParsedRequest);
    } else if (k.length >= 3) {
      const field = String(k[2]);
      requests[index][field] = obj.v;
    }
  }

  const events: VscodeUsageEvent[] = [];
  for (const request of requests) {
    if (typeof request.copilotCredits !== 'number') continue;
    const model = (request.modelId ?? 'unknown').replace(/^copilot\//, '');
    const timestampMs = typeof request.timestamp === 'number' ? request.timestamp : (creationDate ?? Date.now());
    events.push({
      sessionId,
      project,
      model,
      aiuCredits: request.copilotCredits,
      inputTokens: typeof request.promptTokens === 'number' ? request.promptTokens : 0,
      outputTokens: typeof request.completionTokens === 'number' ? request.completionTokens : 0,
      createdAt: toSqliteTimestamp(timestampMs),
    });
  }

  const sessions: VscodeSessionSummary[] = [];
  if (events.length > 0) {
    sessions.push({
      sessionId,
      project,
      summary: customTitle,
      createdAt: toSqliteTimestamp(creationDate ?? Date.parse(events[0].createdAt.replace(' ', 'T') + 'Z')),
    });
  }

  return { events, sessions };
}

/**
 * Scans every workspace folder under `workspaceStorageDir` for chat session
 * logs and aggregates all completed-request usage events. Best-effort: any
 * unreadable or malformed file/folder is skipped rather than throwing, since
 * this data is a supplementary source layered on top of the Copilot CLI
 * database.
 */
export function loadVscodeUsage(workspaceStorageDir: string): VscodeUsageData {
  const events: VscodeUsageEvent[] = [];
  const sessions: VscodeSessionSummary[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workspaceStorageDir, { withFileTypes: true });
  } catch {
    return { events, sessions };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workspaceDir = path.join(workspaceStorageDir, entry.name);
    const project = resolveWorkspaceProject(path.join(workspaceDir, 'workspace.json'));
    const chatSessionsDir = path.join(workspaceDir, 'chatSessions');

    let files: string[];
    try {
      files = fs.readdirSync(chatSessionsDir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      try {
        const parsed = parseChatSessionFile(path.join(chatSessionsDir, file), project);
        events.push(...parsed.events);
        sessions.push(...parsed.sessions);
      } catch {
        // Skip malformed/corrupt session files.
      }
    }
  }

  return { events, sessions };
}
