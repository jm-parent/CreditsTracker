import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts/types/component/Tooltip';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { CreditDropLabel } from './CreditDropLabel';
import { getColorForKey } from '../lib/colors';
import { useCreditChanges } from '../hooks/useCreditChanges';
import type { TimeSeriesPoint } from '../../shared/types';

interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
  onDayClick?: (date: string) => void;
  updateContextKey: string;
}

const CREDIT_CHART_ANIMATION_DURATION_MS = 1_200;

// Segment keys combine the date and project with a NUL separator so a
// project name that happens to contain other punctuation can't collide with
// the date portion of another point's key.
function projectSegmentKey(date: string, projectKey: string): string {
  return `${date}\u0000${projectKey}`;
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

export function TimeSeriesChart({ data, onDayClick, updateContextKey }: TimeSeriesChartProps) {
  // Collect every project key seen across the whole range so each gets a
  // stable stacked-bar series, even on days it had no activity.
  const projectKeys = Array.from(
    new Set(data.flatMap((point) => Object.keys(point.byProject ?? {}))),
  ).sort();

  const changeValues =
    projectKeys.length > 0
      ? data.flatMap((point) =>
          projectKeys.map((projectKey) => ({
            key: projectSegmentKey(point.date, projectKey),
            value: point.byProject?.[projectKey] ?? 0,
          })),
        )
      : data.map((point) => ({ key: point.date, value: point.aiuCredits }));
  const changes = useCreditChanges(
    data,
    changeValues,
    updateContextKey,
    CREDIT_CHART_ANIMATION_DURATION_MS,
  );

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
              <BarChart data={data} margin={{ top: 28 }}>
                <XAxis dataKey="date" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip content={StackedTooltip} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
                {projectKeys.length > 0 ? (
                  projectKeys.map((key, projectIndex) => (
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
                      // triggers it, not just the (possibly tiny) visible
                      // segment. It's applied to every stacked series
                      // (not just one) because Recharts skips rendering a
                      // series' background on a day where that specific
                      // series contributed 0 — only whichever series is
                      // non-zero that day ends up producing it.
                      background={{ fill: 'transparent' }}
                    >
                      {data.map((point) => (
                        <Cell key={projectSegmentKey(point.date, key)} />
                      ))}
                      <LabelList
                        dataKey={(point: TimeSeriesPoint) => point.byProject?.[key] ?? 0}
                        content={(labelProps) => {
                          const index = Number(labelProps.index);
                          const point = data[index];
                          if (!point) return null;
                          return (
                            <CreditDropLabel
                              {...labelProps}
                              change={changes.get(projectSegmentKey(point.date, key))}
                              color={getColorForKey(key)}
                              offsetX={(projectIndex - (projectKeys.length - 1) / 2) * 6}
                            />
                          );
                        }}
                      />
                    </Bar>
                  ))
                ) : (
                  <Bar
                    dataKey="aiuCredits"
                    fill="#22d3ee"
                    cursor={onDayClick ? 'pointer' : undefined}
                    onClick={handleBarClick}
                    background={{ fill: 'transparent' }}
                  >
                    {data.map((point) => (
                      <Cell key={point.date} />
                    ))}
                    <LabelList
                      dataKey="aiuCredits"
                      content={(labelProps) => {
                        const index = Number(labelProps.index);
                        const point = data[index];
                        if (!point) return null;
                        return (
                          <CreditDropLabel
                            {...labelProps}
                            change={changes.get(point.date)}
                            color="#22d3ee"
                            offsetX={0}
                          />
                        );
                      }}
                    />
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
