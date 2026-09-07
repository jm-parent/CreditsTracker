import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BreakdownPoint } from '../../shared/types';

interface BreakdownChartProps {
  title: string;
  data: BreakdownPoint[];
}

export function BreakdownChart({ title, data }: BreakdownChartProps) {
  return (
    <div className="chart-card">
      <h3>{title}</h3>
      {data.length === 0 ? (
        <p>No data for this selection.</p>
      ) : (
        <div data-testid="breakdown-chart" style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={data}>
              <XAxis dataKey="key" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="aiuCredits" fill="#2563eb" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
