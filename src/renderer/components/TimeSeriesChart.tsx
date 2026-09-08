import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts/types/component/Tooltip';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { getColorForKey } from '../lib/colors';
import type { TimeSeriesPoint } from '../../shared/types';

interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
  onDayClick?: (date: string) => void;
}

function StackedTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload) {
    return null;
  }

  const nonZeroEntries = payload.filter((entry) => Number(entry.value) > 0);
  if (nonZeroEntries.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        backgroundColor: '#131922',
        border: '1px solid #263242',
        color: '#e5e9f0',
        padding: 10,
      }}
    >
      <p style={{ margin: 0 }}>{label}</p>
      {nonZeroEntries.map((entry) => (
        <p key={String(entry.name)} style={{ margin: 0, color: entry.color }}>
          {entry.name} : {Number(entry.value).toFixed(2)}
        </p>
      ))}
    </div>
  );
}

export function TimeSeriesChart({ data, onDayClick }: TimeSeriesChartProps) {
  // Collect every project key seen across the whole range so each gets a
  // stable stacked-bar series, even on days it had no activity.
  const projectKeys = Array.from(
    new Set(data.flatMap((point) => Object.keys(point.byProject ?? {}))),
  ).sort();

  const handleBarClick = onDayClick
    ? (entry: TimeSeriesPoint) => onDayClick(entry.date)
    : undefined;

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
                <Tooltip content={StackedTooltip} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
                {projectKeys.length > 0 ? (
                  projectKeys.map((key, index) => (
                    <Bar
                      key={key}
                      dataKey={(point: TimeSeriesPoint) => point.byProject?.[key] ?? 0}
                      name={key}
                      stackId="credits"
                      fill={getColorForKey(key)}
                      cursor={onDayClick ? 'pointer' : undefined}
                      onClick={handleBarClick}
                      // Recharts draws this as a transparent rect spanning the
                      // whole plot height for the bar's column (the same grey
                      // area the hover cursor highlights), reusing the same
                      // onClick — so clicking anywhere in a day's column
                      // triggers it, not just the (possibly tiny) visible bar.
                      // Only needed once per column, so it's added to a single
                      // series rather than every stacked one.
                      background={index === 0 ? { fill: 'transparent' } : undefined}
                    />
                  ))
                ) : (
                  <Bar
                    dataKey="aiuCredits"
                    fill="#22d3ee"
                    cursor={onDayClick ? 'pointer' : undefined}
                    onClick={handleBarClick}
                    background={{ fill: 'transparent' }}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
