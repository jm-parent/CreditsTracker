import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import type { TimeSeriesPoint } from '../../shared/types';

interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
}

export function TimeSeriesChart({ data }: TimeSeriesChartProps) {
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
              <LineChart data={data}>
                <XAxis dataKey="date" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#131922', border: '1px solid #263242', color: '#e5e9f0' }} />
                <Line type="monotone" dataKey="aiuCredits" stroke="#22d3ee" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
