import { CalendarDays, Cpu, Database, FolderKanban } from 'lucide-react';

export type DashboardTab = 'daily' | 'projects' | 'models' | 'raw';

interface SidebarProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
}

const ENTRIES: Array<{ id: DashboardTab; label: string; icon: typeof CalendarDays }> = [
  { id: 'daily', label: 'Daily consumption', icon: CalendarDays },
  { id: 'projects', label: 'By project', icon: FolderKanban },
  { id: 'models', label: 'By model', icon: Cpu },
  { id: 'raw', label: 'Raw data', icon: Database },
];

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
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
    </nav>
  );
}
