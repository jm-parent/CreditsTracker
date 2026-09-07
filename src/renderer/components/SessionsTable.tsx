import { useState } from 'react';
import type { BreakdownPoint } from '../../shared/types';

interface SessionsTableProps {
  rows: BreakdownPoint[];
}

// Three-state cycle instead of a plain boolean toggle: starting in 'default'
// renders descending order (same as 'desc'), so the first click only commits
// to 'desc' (no visible change) and the second click is what actually flips
// to ascending. From then on it behaves as a normal desc/asc toggle.
type SortDirection = 'default' | 'desc' | 'asc';

function nextSortDirection(current: SortDirection): SortDirection {
  if (current === 'asc') {
    return 'desc';
  }
  return current === 'default' ? 'desc' : 'asc';
}

export function SessionsTable({ rows }: SessionsTableProps) {
  const [sort, setSort] = useState<SortDirection>('default');

  if (rows.length === 0) {
    return <p>No sessions for this selection.</p>;
  }

  const sortedRows = [...rows].sort((a, b) =>
    sort === 'asc' ? a.aiuCredits - b.aiuCredits : b.aiuCredits - a.aiuCredits,
  );

  return (
    <table>
      <thead>
        <tr>
          <th>Project</th>
          <th role="columnheader" onClick={() => setSort(nextSortDirection)} style={{ cursor: 'pointer' }}>
            AIU credits
          </th>
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => (
          <tr key={row.key}>
            <td>{row.key}</td>
            <td>{row.aiuCredits.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
