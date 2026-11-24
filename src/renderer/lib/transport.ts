import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UpdateState, RendererLogInput } from '../../shared/types';

/**
 * Picks the transport behind `window.api`. Inside the Tauri shell the methods
 * call Rust commands through `invoke`; anywhere else (Electron, until cutover)
 * the preload bridge installed by `src/preload.ts` stays in place. Only the
 * transport changes: the method signatures are the ones declared in
 * `window.d.ts`.
 */
export function isTauriRuntime(target: Window = window): boolean {
  return '__TAURI_INTERNALS__' in target;
}

/** Tauri rejects with the bare error string, so it is wrapped to match Electron's `Error` rejections. */
function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args).catch((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

/** Same flattening as `serializeDetail` in `src/preload.ts`: errors and other values must survive JSON. */
function serializeDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) {
    return undefined;
  }
  if (typeof detail === 'string') {
    return detail;
  }
  if (detail instanceof Error) {
    return detail.stack ?? `${detail.name}: ${detail.message}`;
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

export function createTauriApi(): Window['api'] {
  return {
    getFilterOptions: () => call('get_filter_options'),
    getUsage: (filters) => call('get_usage', { filters }),
    getProjectDetail: (params) => call('get_project_detail', { params }),
    getRawTablePage: (params) => call('get_raw_table_page', { params }),
    getHourlyDetail: (params) => call('get_hourly_detail', { params }),
    getMonthlyActivity: (params) => call('get_monthly_activity', { params }),
    getExportPreview: (filters) => call('get_export_preview', { filters }),
    exportHtml: (request) => call('export_html', { request }),
    getAppVersion: () => call('get_app_version'),
    getUpdateState: () => call<UpdateState>('get_update_state'),
    checkForUpdate: () => call<UpdateState>('check_for_update'),
    downloadUpdate: () => call<UpdateState>('download_update'),
    restartToUpdate: () => call('restart_to_update'),
    // Returns an unsubscribe function so React effects can detach the listener
    // on unmount instead of leaking one per mount.
    onUpdateStateChange: (listener) => {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      void listen<UpdateState>('update-state-changed', (event) => listener(event.payload)).then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      });
      return () => {
        disposed = true;
        unlisten?.();
      };
    },
    shouldPromptDesktopShortcut: () => call('should_prompt_desktop_shortcut'),
    createDesktopShortcut: () => call('create_desktop_shortcut'),
    getAgentTraceCollectionStatus: () => call('get_agent_trace_collection_status'),
    setAgentTraceCollectionEnabled: (enabled) => call('set_agent_trace_collection_enabled', { enabled }),
    getAgentTraceSession: (selection) => call('get_agent_trace_session', { selection }),
    clearAgentTraceData: () => call('clear_agent_trace_data'),
    getLogs: () => call('get_logs'),
    clearLogs: () => call('clear_logs'),
    openLogFile: () => call('open_log_file'),
    openExternalUrl: (url) => call('open_external_url', { url }),
    log: (entry: RendererLogInput) =>
      call('log_message', {
        entry: {
          level: entry.level,
          scope: entry.scope,
          message: entry.message,
          detail: serializeDetail(entry.detail),
        },
      }),
  };
}

/** Replaces `window.api` with the Tauri-backed transport when running inside the Tauri shell. */
export function installTransport(target: Window = window): void {
  if (isTauriRuntime(target)) {
    target.api = createTauriApi();
  }
}
