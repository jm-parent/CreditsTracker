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
    render(<SessionsTable rows={rows} />);

    const dataRows = screen.getAllByRole('row').slice(1); // skip header row
    expect(within(dataRows[0]).getByText('org/repo-b')).toBeInTheDocument();
    expect(within(dataRows[1]).getByText('org/repo-a')).toBeInTheDocument();
  });

  it('renders a no-data message when there are no rows', () => {
    render(<SessionsTable rows={[]} />);

    expect(screen.getByText('No sessions for this selection.')).toBeInTheDocument();
  });

  it('re-sorts ascending when the credits header is clicked twice', async () => {
    const user = userEvent.setup();
    render(<SessionsTable rows={rows} />);

    const header = screen.getByRole('columnheader', { name: 'AIU credits' });
    await user.click(header);
    await user.click(header);

    const dataRows = screen.getAllByRole('row').slice(1);
    expect(within(dataRows[0]).getByText('org/repo-a')).toBeInTheDocument();
  });
});
