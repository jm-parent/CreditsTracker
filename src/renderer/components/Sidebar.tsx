import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  CalendarDays,
  Cpu,
  Database,
  FolderKanban,
  RotateCcw,
  ScrollText,
} from 'lucide-react';
import type { UpdateState } from '../../shared/types';

export type DashboardTab = 'daily' | 'monthly' | 'projects' | 'models' | 'raw' | 'logs';

interface SidebarProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  appVersion?: string;
  /** Current update state, or null while it hasn't been read yet. */
  updateState?: UpdateState | null;
  onUpdateClick?: () => void;
}

const ENTRIES: Array<{ id: DashboardTab; label: string; icon: typeof CalendarDays }> = [
  { id: 'daily', label: 'Daily consumption', icon: CalendarDays },
  { id: 'monthly', label: 'Monthly activity', icon: Activity },
  { id: 'projects', label: 'By project', icon: FolderKanban },
  { id: 'models', label: 'By model', icon: Cpu },
  { id: 'raw', label: 'Raw data', icon: Database },
  { id: 'logs', label: 'Logs', icon: ScrollText },
];

export function Sidebar({
  activeTab,
  onTabChange,
  appVersion,
  updateState,
  onUpdateClick,
}: SidebarProps) {
  // The badge is only an entry point into the dialog, so it shows for every
  // state the user can act on — a pending update, one being downloaded, one
  // staged and waiting for a restart, or a failed attempt to retry.
  const actionableStatuses: Array<UpdateState['status']> = [
    'available',
    'downloading',
    'ready',
    'error',
  ];
  const showUpdateBadge = Boolean(updateState && actionableStatuses.includes(updateState.status));
  const badge = updateState?.status === 'ready'
    ? { label: 'Update ready — restart to apply', icon: RotateCcw, tone: 'text-accent' }
    : updateState?.status === 'error'
      ? { label: 'Update failed — click for details', icon: AlertCircle, tone: 'text-red-400' }
      : { label: `Update available${updateState?.latestVersion ? ` (v${updateState.latestVersion})` : ''}`, icon: ArrowDownToLine, tone: 'text-primary' };
  const BadgeIcon = badge.icon;

  return (
    <nav className="sidebar flex h-screen w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-4">
      {ENTRIES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onTabChange(id)}
          aria-current={activeTab === id ? 'page' : undefined}
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
            activeTab === id
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground hover:bg-muted'
          }`}
        >
          <Icon size={16} aria-hidden="true" />
          {label}
        </button>
      ))}
      {appVersion && (
        <div className="mt-auto flex items-center gap-1.5 px-3 pt-4">
          <p className="text-xs text-muted-foreground">v{appVersion}</p>
          {showUpdateBadge && (
            <button
              type="button"
              onClick={onUpdateClick}
              title={badge.label}
              aria-label={badge.label}
              className={`rounded-full p-1 hover:bg-muted ${badge.tone} ${
                updateState?.status === 'downloading' ? 'animate-pulse' : ''
              }`}
            >
              <BadgeIcon size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
