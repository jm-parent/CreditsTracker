import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MouseHandlerDataParam } from 'recharts/types/synchronisation/types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { getColorForKey } from '../lib/colors';
import { useCreditChanges } from '../hooks/useCreditChanges';
import type { BreakdownPoint } from '../../shared/types';

interface BreakdownChartProps {
  title: string;
  data: BreakdownPoint[];
  onBarClick?: (key: string) => void;
  colorByKey?: boolean;
  updateContextKey: string;
}

const CREDIT_CHART_ANIMATION_DURATION_MS = 1_000;

export function BreakdownChart({
  title,
  data,
  onBarClick,
  colorByKey = false,
  updateContextKey,
}: BreakdownChartProps) {
  const changes = useCreditChanges(
    data,
    data.map(({ key, aiuCredits }) => ({ key, value: aiuCredits })),
    updateContextKey,
    CREDIT_CHART_ANIMATION_DURATION_MS,
  );

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
                <Tooltip
                  contentStyle={{ backgroundColor: '#131922', border: '1px solid #263242', color: '#e5e9f0' }}
                  cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
                />
                <Bar
                  dataKey="aiuCredits"
                  fill="#22d3ee"
                  cursor={onBarClick ? 'pointer' : undefined}
                  onClick={onBarClick ? (entry: BreakdownPoint) => onBarClick(entry.key) : undefined}
                >
                  {data.map((entry) => {
                    const isUpdated = changes.has(entry.key);
                    return (
                      <Cell
                        key={entry.key}
                        {...(colorByKey ? { fill: getColorForKey(entry.key) } : {})}
                        {...(isUpdated
                          ? { className: 'credit-chart-updated', 'data-credit-updated': 'true' }
                          : {})}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
