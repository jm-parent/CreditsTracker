import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { getColorForKey } from '../lib/colors';
import type { TimeSeriesPoint } from '../../shared/types';

interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
}

export function TimeSeriesChart({ data }: TimeSeriesChartProps) {
  // Collect every project key seen across the whole range so each gets a
  // stable stacked-bar series, even on days it had no activity.
  const projectKeys = Array.from(
    new Set(data.flatMap((point) => Object.keys(point.byProject ?? {}))),
  ).sort();

  return (
    <Card className="chart-card">
      <CardHeader>
        <CardTitle>Credits over time</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data for this selection.</p>
        ) : (
          <div data-testid="time-series-chart" style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={data}>
                <XAxis dataKey="date" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#131922', border: '1px solid #263242', color: '#e5e9f0' }} />
                {projectKeys.length > 0 ? (
                  projectKeys.map((key) => (
                    <Bar
                      key={key}
                      dataKey={(point: TimeSeriesPoint) => point.byProject?.[key] ?? 0}
                      name={key}
                      stackId="credits"
                      fill={getColorForKey(key)}
                    />
                  ))
                ) : (
                  <Bar dataKey="aiuCredits" fill="#22d3ee" />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
