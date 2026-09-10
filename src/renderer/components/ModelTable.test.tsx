import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelTable } from './ModelTable';

describe('ModelTable', () => {
  it('shows an empty message when there are no rows', () => {
    render(<ModelTable rows={[]} updateContextKey="all" />);
    expect(screen.getByText('No models for this selection.')).toBeInTheDocument();
  });

  it('renders each model with its credits and percentage of the total', () => {
    render(
      <ModelTable
        rows={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 1 },
        ]}
        updateContextKey="all"
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
        updateContextKey="all"
      />,
    );

    const header = screen.getByText('AIU credits').closest('th') as HTMLElement;
    await user.click(header); // desc (no visible change, same as default)
    await user.click(header); // asc

    const rows = screen.getAllByRole('row').slice(1); // skip header row
    expect(within(rows[0]).getByText('gpt-5.4')).toBeInTheDocument();
    expect(within(rows[1]).getByText('claude-sonnet-5')).toBeInTheDocument();
  });

  it('keeps each credit delta with its own row even when sorting reorders the rows', () => {
    const initialRows = [
      { key: 'claude-sonnet-5', aiuCredits: 3 },
      { key: 'gpt-5.4', aiuCredits: 1 },
    ];
    const { rerender } = render(<ModelTable rows={initialRows} updateContextKey="all" />);

    const updatedRows = [
      { key: 'claude-sonnet-5', aiuCredits: 3 }, // unchanged
      { key: 'gpt-5.4', aiuCredits: 6 }, // was 1, now sorts to the top
    ];
    rerender(<ModelTable rows={updatedRows} updateContextKey="all" />);

    const claudeRow = screen.getByText('claude-sonnet-5').closest('tr') as HTMLElement;
    const gptRow = screen.getByText('gpt-5.4').closest('tr') as HTMLElement;
    expect(within(gptRow).getByText('+5.00')).toBeInTheDocument();
    expect(within(claudeRow).queryByText(/^[+−]/)).not.toBeInTheDocument();
  });

  it('clears deltas when the update context key changes', () => {
    const initialRows = [
      { key: 'claude-sonnet-5', aiuCredits: 3 },
      { key: 'gpt-5.4', aiuCredits: 1 },
    ];
    const { rerender } = render(<ModelTable rows={initialRows} updateContextKey="all" />);

    rerender(
      <ModelTable
        rows={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 6 },
        ]}
        updateContextKey="workspace"
      />,
    );

    const gptRow = screen.getByText('gpt-5.4').closest('tr') as HTMLElement;
    expect(within(gptRow).queryByText(/^[+−]/)).not.toBeInTheDocument();
  });
});
