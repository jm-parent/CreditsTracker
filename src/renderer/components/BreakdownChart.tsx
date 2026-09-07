import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MouseHandlerDataParam } from 'recharts/types/synchronisation/types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import type { BreakdownPoint } from '../../shared/types';

interface BreakdownChartProps {
  title: string;
  data: BreakdownPoint[];
  onBarClick?: (key: string) => void;
}

export function BreakdownChart({ title, data, onBarClick }: BreakdownChartProps) {
  function handleChartClick(state: MouseHandlerDataParam): void {
    if (onBarClick && typeof state?.activeLabel === 'string') {
      onBarClick(state.activeLabel);
    }
  }

  return (
    <Card className="chart-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data for this selection.</p>
        ) : (
          <div data-testid="breakdown-chart" style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={data} onClick={onBarClick ? handleChartClick : undefined}>
                <XAxis dataKey="key" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#131922', border: '1px solid #263242', color: '#e5e9f0' }} />
                <Bar
                  dataKey="aiuCredits"
                  fill="#22d3ee"
                  cursor={onBarClick ? 'pointer' : undefined}
                  onClick={onBarClick ? (entry: BreakdownPoint) => onBarClick(entry.key) : undefined}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
