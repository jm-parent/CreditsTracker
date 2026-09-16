import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportPage } from './ExportPage';
import { createWindowApi } from '../test-utils/windowApi';
import { resetLogDedupeForTests } from '../lib/logger';
import type { ExportPreview, FilterOptions } from '../../shared/types';
import * as logger from '../lib/logger';

const options: FilterOptions = {
  projects: ['org/repo-a'],
  models: ['claude-sonnet-5', 'gpt-5.4'],
  minDate: '2026-09-01',
  maxDate: '2026-09-30',
};

const preview: ExportPreview = {
  totals: { aiuCredits: 6, tokens: 225, requests: 3 },
  sessionCount: 2,
  activeDays: 2,
  byModel: [
    { model: 'claude-sonnet-5', aiuCredits: 3, sharePercent: 50 },
    { model: 'gpt-5.4', aiuCredits: 3, sharePercent: 50 },
  ],
  daily: [
    { date: '2026-09-01', aiuCredits: 4, tokens: 180, requests: 2 },
    { date: '2026-09-03', aiuCredits: 2, tokens: 45, requests: 1 },
  ],
};

beforeEach(() => {
  resetLogDedupeForTests();
  window.api = createWindowApi({
    getExportPreview: vi.fn().mockResolvedValue(preview),
    exportCsv: vi.fn().mockResolvedValue({
      cancelled: false,
      summaryPath: 'C:\\reports\\usage-summary.csv',
      sessionsPath: 'C:\\reports\\usage-sessions.csv',
      summaryRows: 2,
      sessionRows: 2,
    }),
  });
});

describe('ExportPage', () => {
  it('renders the preview cards and exports the current filters', async () => {
    const user = userEvent.setup();

    render(<ExportPage options={options} />);

    expect(await screen.findByText('6.00')).toBeInTheDocument();
    expect(screen.getByText('225')).toBeInTheDocument();
    expect(screen.getAllByText('Requests').length).toBeGreaterThan(0);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getAllByText('50.00%')).toHaveLength(2);
    expect(screen.getByText('2026-09-01')).toBeInTheDocument();
    expect(screen.getByText('2026-09-03')).toBeInTheDocument();

    const exportButton = screen.getByRole('button', { name: 'Export 2 CSV files' });
    expect(exportButton).toBeEnabled();

    await user.click(exportButton);

    expect(window.api.exportCsv).toHaveBeenCalledWith({
      filters: {},
      suggestedName: 'copilot-usage.csv',
    });
    expect(
      await screen.findByText(/usage-summary\.csv \(2 rows\).*usage-sessions\.csv \(2 rows\)/),
    ).toBeInTheDocument();
  });

  it('shows an empty-state message and keeps export disabled when the preview is empty', async () => {
    window.api.getExportPreview = vi.fn().mockResolvedValue({
      totals: { aiuCredits: 0, tokens: 0, requests: 0 },
      sessionCount: 0,
      activeDays: 0,
      byModel: [],
      daily: [],
    });

    render(<ExportPage options={options} />);

    expect(await screen.findByText('No usage for this selection.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export 2 CSV files' })).toBeDisabled();
  });

  it('shows a validation message and does not request another preview for an invalid custom range', async () => {
    render(<ExportPage options={options} />);

    await screen.findByText('6.00');
    expect(window.api.getExportPreview).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-01' } });
    await waitFor(() => expect(window.api.getExportPreview).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-07' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Start date must be on or before end date.');
    expect(screen.getByRole('button', { name: 'Export 2 CSV files' })).toBeDisabled();
    expect(window.api.getExportPreview).toHaveBeenCalledTimes(2);
  });

  it('shows a retryable preview error when loading the report fails', async () => {
    window.api.getExportPreview = vi
      .fn()
      .mockRejectedValueOnce(new Error('preview failed'))
      .mockResolvedValueOnce(preview);
    const user = userEvent.setup();

    render(<ExportPage options={options} />);

    expect(await screen.findByText("Couldn't load the export preview.")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry preview' }));

    expect(await screen.findByText('6.00')).toBeInTheDocument();
    expect(window.api.getExportPreview).toHaveBeenCalledTimes(2);
  });

  it('shows an export error alert when the CSV export fails', async () => {
    const boom = new Error('disk full');
    window.api.exportCsv = vi.fn().mockRejectedValue(boom);
    const logError = vi.spyOn(logger, 'logError').mockImplementation(() => undefined);
    const user = userEvent.setup();

    render(<ExportPage options={options} />);

    await user.click(await screen.findByRole('button', { name: 'Export 2 CSV files' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not export the CSV files. Please try again.');
    expect(logError).toHaveBeenCalledWith('ExportPage', 'CSV export failed', boom);
  });

  it('does not show a success message when the export is cancelled', async () => {
    window.api.exportCsv = vi.fn().mockResolvedValue({ cancelled: true });
    const user = userEvent.setup();

    render(<ExportPage options={options} />);

    await user.click(await screen.findByRole('button', { name: 'Export 2 CSV files' }));

    await waitFor(() => expect(window.api.exportCsv).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/usage-summary\.csv/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
