import { useState } from 'react';
import { useRawTable } from '../hooks/useRawTable';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Skeleton } from './ui/skeleton';
import type { RawTableName } from '../../shared/types';

interface RawDataPageProps {
  onBack: () => void;
}

const TABS: Array<{ id: RawTableName; label: string }> = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'assistant_usage_events', label: 'Usage events' },
];

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  return String(value);
}

export function RawDataPage({ onBack }: RawDataPageProps) {
  const [table, setTable] = useState<RawTableName>('sessions');
  const [page, setPage] = useState(0);
  const { data, loading, error } = useRawTable(table, page);

  function handleTabChange(nextTable: RawTableName): void {
    setTable(nextTable);
    setPage(0);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="raw-data-page flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          ← Back
        </button>
        <h2 className="text-xl font-semibold text-foreground">Raw data</h2>
      </div>

      <div className="flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleTabChange(tab.id)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              table === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-foreground hover:bg-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && !data && (
        <p className="text-sm text-muted-foreground">Couldn't load this table.</p>
      )}

      {loading && !data && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}

      {data && data.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No rows in this table.</p>
      )}

      {data && data.rows.length > 0 && (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {data.columns.map((column) => (
                      <TableHead key={column}>{column}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row, index) => (
                    <TableRow key={index}>
                      {data.columns.map((column) => (
                        <TableCell key={column}>{formatCellValue(row[column])}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {data.page + 1} of {totalPages} ({data.total} rows)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={data.page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={data.page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
