import { Card, CardContent } from './ui/card';
import type { WeeklyActivityPoint } from '../../shared/types';

export interface ActivityHeatmapPageProps {
  data: WeeklyActivityPoint[];
  loading: boolean;
  error: Error | null;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const INTENSITY_LEVELS = 4;

interface Bucket {
  weekday: number;
  hour: number;
  aiuCredits: number;
}

function buildMatrix(data: WeeklyActivityPoint[]): Bucket[][] {
  const matrix: Bucket[][] = WEEKDAY_LABELS.map((_, weekday) =>
    Array.from({ length: 24 }, (_, hour) => ({ weekday, hour, aiuCredits: 0 })),
  );
  for (const point of data) {
    if (point.weekday < 0 || point.weekday > 6 || point.hour < 0 || point.hour > 23) continue;
    matrix[point.weekday][point.hour].aiuCredits += point.aiuCredits;
  }
  return matrix;
}

function intensityLevel(credits: number, maxCredits: number): number {
  if (maxCredits <= 0 || credits <= 0) return 0;
  const ratio = credits / maxCredits;
  return Math.max(1, Math.min(INTENSITY_LEVELS, Math.ceil(ratio * INTENSITY_LEVELS)));
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function cellLabel(bucket: Bucket): string {
  return `${WEEKDAY_LABELS[bucket.weekday]}, ${formatHour(bucket.hour)}: ${bucket.aiuCredits.toFixed(2)} credits`;
}

export function ActivityHeatmapPage({ data, loading, error }: ActivityHeatmapPageProps) {
  const matrix = buildMatrix(data);
  const flatBuckets = matrix.flat();
  const maxCredits = flatBuckets.reduce((max, b) => Math.max(max, b.aiuCredits), 0);
  const activeBuckets = flatBuckets.filter((b) => b.aiuCredits > 0);
  const isEmpty = activeBuckets.length === 0;

  const busiest = activeBuckets.reduce<Bucket | null>(
    (top, b) => (!top || b.aiuCredits > top.aiuCredits ? b : top),
    null,
  );
  const quietest = activeBuckets.reduce<Bucket | null>(
    (bottom, b) => (!bottom || b.aiuCredits < bottom.aiuCredits ? b : bottom),
    null,
  );

  return (
    <div className="activity-heatmap-page flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="summary-card">
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="summary-value text-2xl font-semibold text-foreground">
              {busiest ? `${WEEKDAY_LABELS[busiest.weekday]}, ${formatHour(busiest.hour)}` : 'No activity'}
            </span>
            <span className="summary-label text-sm text-muted-foreground">Busiest window</span>
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
              {quietest ? `${WEEKDAY_LABELS[quietest.weekday]}, ${formatHour(quietest.hour)}` : 'No activity'}
            </span>
            <span className="summary-label text-sm text-muted-foreground">Quietest active window</span>
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
          {error && (
            <p className="text-sm text-muted-foreground">Couldn't refresh — showing last known data.</p>
          )}
          {isEmpty && (
            <p className="activity-heatmap-empty text-sm text-muted-foreground">
              No credit consumption recorded for the current filters.
            </p>
          )}
          <div className="overflow-x-auto">
            <div
              className="activity-heatmap-grid grid gap-1"
              style={{ gridTemplateColumns: 'auto repeat(24, minmax(1.5rem, 1fr))' }}
              aria-busy={loading}
            >
              <div />
              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={`hour-${hour}`}
                  className="text-center text-xs text-muted-foreground"
                  aria-hidden="true"
                >
                  {hour % 4 === 0 ? formatHour(hour) : ''}
                </div>
              ))}
              {matrix.map((row, weekday) => (
                <div className="contents" key={`row-${weekday}`}>
                  <div className="pr-2 text-xs text-muted-foreground">{WEEKDAY_LABELS[weekday]}</div>
                  {row.map((bucket) => {
                    const level = intensityLevel(bucket.aiuCredits, maxCredits);
                    return (
                      <button
                        key={`cell-${bucket.weekday}-${bucket.hour}`}
                        type="button"
                        className={`activity-heatmap-cell h-6 w-full rounded-sm intensity-${level}`}
                        style={{
                          backgroundColor:
                            level === 0
                              ? 'var(--color-muted)'
                              : `color-mix(in srgb, var(--color-accent) ${level * 20 + 20}%, var(--color-primary))`,
                        }}
                        aria-label={cellLabel(bucket)}
                        title={cellLabel(bucket)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
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
                style={{
                  backgroundColor:
                    level === 0
                      ? 'var(--color-muted)'
                      : `color-mix(in srgb, var(--color-accent) ${level * 20 + 20}%, var(--color-primary))`,
                }}
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
