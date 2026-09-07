import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Skeleton } from './ui/skeleton';
import { getColorForKey } from '../lib/colors';
import type { HourlyPoint } from '../../shared/types';

interface HourlyDetailPanelProps {
  date: string;
  data: HourlyPoint[] | null;
  loading: boolean;
  error: Error | null;
  onClose: () => void;
}

export function HourlyDetailPanel({ date, data, loading, error, onClose }: HourlyDetailPanelProps) {
  const projectKeys = Array.from(
    new Set((data ?? []).flatMap((point) => Object.keys(point.byProject))),
  ).sort();

  return (
    <div
      role="dialog"
      aria-label={`Hourly detail for ${date}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-3xl overflow-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <Card className="chart-card">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base text-foreground">Hourly detail — {date}</CardTitle>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
            >
              Close
            </button>
          </CardHeader>
          <CardContent>
            {loading && !data && (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            )}
            {error && !data && (
              <p className="text-sm text-muted-foreground">Couldn't load hourly detail.</p>
            )}
            {data && data.length === 0 && (
              <p className="text-sm text-muted-foreground">No data for this day.</p>
            )}
            {data && data.length > 0 && (
              <div data-testid="hourly-detail-chart" style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={data}>
                    <XAxis dataKey="hour" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#131922',
                        border: '1px solid #263242',
                        color: '#e5e9f0',
                      }}
                    />
                    {projectKeys.map((key) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={(point: HourlyPoint) => point.byProject[key] ?? 0}
                        name={key}
                        stroke={getColorForKey(key)}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
