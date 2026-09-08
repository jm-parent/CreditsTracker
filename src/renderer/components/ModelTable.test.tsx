import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelTable } from './ModelTable';

describe('ModelTable', () => {
  it('shows an empty message when there are no rows', () => {
    render(<ModelTable rows={[]} />);
    expect(screen.getByText('No models for this selection.')).toBeInTheDocument();
  });

  it('renders each model with its credits and percentage of the total', () => {
    render(
      <ModelTable
        rows={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 1 },
        ]}
      />,
    );

    expect(screen.getByText('Model')).toBeInTheDocument();
    const claudeRow = screen.getByText('claude-sonnet-5').closest('tr') as HTMLElement;
    expect(within(claudeRow).getByText('3.00')).toBeInTheDocument();
    expect(within(claudeRow).getByText('75.0%')).toBeInTheDocument();

    const gptRow = screen.getByText('gpt-5.4').closest('tr') as HTMLElement;
    expect(within(gptRow).getByText('1.00')).toBeInTheDocument();
    expect(within(gptRow).getByText('25.0%')).toBeInTheDocument();
  });

  it('sorts by credits ascending after two header clicks', async () => {
    const user = userEvent.setup();
    render(
      <ModelTable
        rows={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 1 },
        ]}
      />,
    );

    const header = screen.getByText('AIU credits').closest('th') as HTMLElement;
    await user.click(header); // desc (no visible change, same as default)
    await user.click(header); // asc

    const rows = screen.getAllByRole('row').slice(1); // skip header row
    expect(within(rows[0]).getByText('gpt-5.4')).toBeInTheDocument();
    expect(within(rows[1]).getByText('claude-sonnet-5')).toBeInTheDocument();
  });
});
