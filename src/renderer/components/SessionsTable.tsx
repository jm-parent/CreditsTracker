import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { getColorForKey } from '../lib/colors';
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
    return <p className="text-sm text-muted-foreground">No sessions for this selection.</p>;
  }

  const sortedRows = [...rows].sort((a, b) =>
    sort === 'asc' ? a.aiuCredits - b.aiuCredits : b.aiuCredits - a.aiuCredits,
  );

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead
                role="columnheader"
                onClick={() => setSort(nextSortDirection)}
                className="cursor-pointer select-none"
              >
                <span className="inline-flex items-center gap-1">
                  AIU credits
                  {sort === 'asc' ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: getColorForKey(row.key) }}
                    />
                    {row.key}
                  </span>
                </TableCell>
                <TableCell>{row.aiuCredits.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
