import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { CreditValue } from './CreditValue';
import { useCreditChanges } from '../hooks/useCreditChanges';
import { getColorForKey } from '../lib/colors';
import type { BreakdownPoint } from '../../shared/types';

export interface ModelTableProps {
  rows: BreakdownPoint[];
  updateContextKey: string;
}

// Three-state cycle instead of a plain boolean toggle: starting in 'default'
// renders descending order (same as 'desc'), so the first click only commits
// to 'desc' (no visible change) and the second click is what actually flips
// to ascending. From then on it behaves as a normal desc/asc toggle.
type SortDirection = 'default' | 'desc' | 'asc';

const CREDIT_DELTA_DURATION_MS = 1_500;

function nextSortDirection(current: SortDirection): SortDirection {
  if (current === 'asc') {
    return 'desc';
  }
  return current === 'default' ? 'desc' : 'asc';
}

export function ModelTable({ rows, updateContextKey }: ModelTableProps) {
  const [sort, setSort] = useState<SortDirection>('default');
  const changes = useCreditChanges(
    rows,
    rows.map((row) => ({ key: row.key, value: row.aiuCredits })),
    updateContextKey,
    CREDIT_DELTA_DURATION_MS,
  );

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No models for this selection.</p>;
  }

  const totalCredits = rows.reduce((sum, row) => sum + row.aiuCredits, 0);
  const sortedRows = [...rows].sort((a, b) =>
    sort === 'asc' ? a.aiuCredits - b.aiuCredits : b.aiuCredits - a.aiuCredits,
  );

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
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
              <TableHead>% of total</TableHead>
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
                <TableCell>
                  <CreditValue value={row.aiuCredits} change={changes.get(row.key)} />
                </TableCell>
                <TableCell>
                  {totalCredits > 0 ? `${((row.aiuCredits / totalCredits) * 100).toFixed(1)}%` : '0.0%'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
