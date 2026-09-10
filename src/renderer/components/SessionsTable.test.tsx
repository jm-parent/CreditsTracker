import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionsTable } from './SessionsTable';

const rows = [
  { key: 'org/repo-a', aiuCredits: 1 },
  { key: 'org/repo-b', aiuCredits: 5 },
];

describe('SessionsTable', () => {
  it('renders one row per entry, sorted by credits descending by default', () => {
    render(<SessionsTable rows={rows} updateContextKey="all" />);

    const dataRows = screen.getAllByRole('row').slice(1); // skip header row
    expect(within(dataRows[0]).getByText('org/repo-b')).toBeInTheDocument();
    expect(within(dataRows[1]).getByText('org/repo-a')).toBeInTheDocument();
  });

  it('renders a no-data message when there are no rows', () => {
    render(<SessionsTable rows={[]} updateContextKey="all" />);

    expect(screen.getByText('No sessions for this selection.')).toBeInTheDocument();
  });

  it('re-sorts ascending when the credits header is clicked twice', async () => {
    const user = userEvent.setup();
    render(<SessionsTable rows={rows} updateContextKey="all" />);

    const header = screen.getByRole('columnheader', { name: 'AIU credits' });
    await user.click(header);
    await user.click(header);

    const dataRows = screen.getAllByRole('row').slice(1);
    expect(within(dataRows[0]).getByText('org/repo-a')).toBeInTheDocument();
  });

  it('keeps each credit delta with its own row even when sorting reorders the rows', () => {
    const { rerender } = render(<SessionsTable rows={rows} updateContextKey="all" />);

    const updatedRows = [
      { key: 'org/repo-a', aiuCredits: 8 }, // was 1, now sorts to the top
      { key: 'org/repo-b', aiuCredits: 5 }, // unchanged
    ];
    rerender(<SessionsTable rows={updatedRows} updateContextKey="all" />);

    const repoARow = screen.getByText('org/repo-a').closest('tr') as HTMLElement;
    const repoBRow = screen.getByText('org/repo-b').closest('tr') as HTMLElement;
    expect(within(repoARow).getByText('+7.00')).toBeInTheDocument();
    expect(within(repoBRow).queryByText(/^[+−]/)).not.toBeInTheDocument();
  });

  it('clears deltas when the update context key changes', () => {
    const { rerender } = render(<SessionsTable rows={rows} updateContextKey="all" />);

    rerender(
      <SessionsTable
        rows={[
          { key: 'org/repo-a', aiuCredits: 8 },
          { key: 'org/repo-b', aiuCredits: 5 },
        ]}
        updateContextKey="workspace"
      />,
    );

    const repoARow = screen.getByText('org/repo-a').closest('tr') as HTMLElement;
    expect(within(repoARow).queryByText(/^[+−]/)).not.toBeInTheDocument();
  });
});
