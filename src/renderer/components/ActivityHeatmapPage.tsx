import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import type { TimeSeriesPoint } from '../../shared/types';

export interface ActivityHeatmapPageProps {
  year: number;
  /** Month number, 1-12. */
  month: number;
  data: TimeSeriesPoint[];
  loading: boolean;
  error: Error | null;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const INTENSITY_LEVELS = 4;

interface DayCell {
  day: number;
  date: string;
  aiuCredits: number;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Converts JS Date.getDay() (0 = Sunday) into a Monday-first column index (0 = Monday .. 6 = Sunday). */
function mondayFirstIndex(jsWeekday: number): number {
  return (jsWeekday + 6) % 7;
}

function buildCalendar(year: number, month: number, data: TimeSeriesPoint[]): (DayCell | null)[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const leadingBlanks = mondayFirstIndex(new Date(year, month - 1, 1).getDay());
  const creditsByDate = new Map(data.map((point) => [point.date, point.aiuCredits]));

  const cells: (DayCell | null)[] = Array.from({ length: leadingBlanks }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${pad(month)}-${pad(day)}`;
    cells.push({ day, date, aiuCredits: creditsByDate.get(date) ?? 0 });
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

function intensityLevel(credits: number, maxCredits: number): number {
  if (maxCredits <= 0 || credits <= 0) return 0;
  const ratio = credits / maxCredits;
  return Math.max(1, Math.min(INTENSITY_LEVELS, Math.ceil(ratio * INTENSITY_LEVELS)));
}

function cellColor(level: number): string {
  return level === 0
    ? 'var(--color-muted)'
    : `color-mix(in srgb, var(--color-accent) ${level * 20 + 20}%, var(--color-primary))`;
}

function formatDayLabel(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function cellLabel(year: number, month: number, cell: DayCell): string {
  return `${formatDayLabel(year, month, cell.day)}: ${cell.aiuCredits.toFixed(2)} credits`;
}

export function ActivityHeatmapPage({
  year,
  month,
  data,
  loading,
  error,
  onPrevMonth,
  onNextMonth,
}: ActivityHeatmapPageProps) {
  const cells = buildCalendar(year, month, data);
  const activeDays = data.filter((point) => point.aiuCredits > 0);
  const maxCredits = activeDays.reduce((max, point) => Math.max(max, point.aiuCredits), 0);
  const isEmpty = activeDays.length === 0;

  const busiest = activeDays.reduce<TimeSeriesPoint | null>(
    (top, point) => (!top || point.aiuCredits > top.aiuCredits ? point : top),
    null,
  );
  const quietest = activeDays.reduce<TimeSeriesPoint | null>(
    (bottom, point) => (!bottom || point.aiuCredits < bottom.aiuCredits ? point : bottom),
    null,
  );

  return (
    <div className="activity-heatmap-page flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="summary-card">
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="summary-value text-2xl font-semibold text-foreground">
              {busiest ? new Date(`${busiest.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No activity'}
            </span>
            <span className="summary-label text-sm text-muted-foreground">Busiest day</span>
            {busiest && (
              <span className="summary-label text-sm text-muted-foreground">
                {busiest.aiuCredits.toFixed(2)} credits
              </span>
            )}
          </CardContent>
        </Card>
        <Card className="summary-card">
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="summary-value text-2xl font-semibold text-foreground">
              {quietest ? new Date(`${quietest.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No activity'}
            </span>
            <span className="summary-label text-sm text-muted-foreground">Quietest active day</span>
            {quietest && (
              <span className="summary-label text-sm text-muted-foreground">
                {quietest.aiuCredits.toFixed(2)} credits
              </span>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="activity-heatmap-card">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onPrevMonth}
              aria-label="Previous month"
              className="rounded-md p-1 text-foreground hover:bg-muted"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <span className="text-sm font-medium text-foreground">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button
              type="button"
              onClick={onNextMonth}
              aria-label="Next month"
              className="rounded-md p-1 text-foreground hover:bg-muted"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>

          {error && (
            <p className="text-sm text-muted-foreground">Couldn't refresh — showing last known data.</p>
          )}
          {isEmpty && (
            <p className="activity-heatmap-empty text-sm text-muted-foreground">
              No credit consumption recorded for this month.
            </p>
          )}

          <div
            className="activity-heatmap-grid grid grid-cols-7 gap-1"
            aria-busy={loading}
            aria-label={`${MONTH_NAMES[month - 1]} ${year} activity calendar`}
          >
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="text-center text-xs text-muted-foreground" aria-hidden="true">
                {label}
              </div>
            ))}
            {cells.map((cell, index) =>
              cell ? (
                <button
                  key={cell.date}
                  type="button"
                  className="activity-heatmap-cell h-8 w-full rounded-sm text-xs text-foreground"
                  style={{ backgroundColor: cellColor(intensityLevel(cell.aiuCredits, maxCredits)) }}
                  aria-label={cellLabel(year, month, cell)}
                  title={cellLabel(year, month, cell)}
                >
                  {cell.day}
                </button>
              ) : (
                <div key={`blank-${index}`} aria-hidden="true" />
              ),
            )}
          </div>

          <div
            className="activity-heatmap-legend flex items-center gap-2 text-xs text-muted-foreground"
            aria-label="Intensity scale from no activity to highest activity"
          >
            <span>Less</span>
            {Array.from({ length: INTENSITY_LEVELS + 1 }, (_, level) => (
              <span
                key={`legend-${level}`}
                className="h-3 w-3 rounded-sm"
                style={{ backgroundColor: cellColor(level) }}
                aria-hidden="true"
              />
            ))}
            <span>More</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
