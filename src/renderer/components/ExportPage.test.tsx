import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportPage } from './ExportPage';
import { createWindowApi } from '../test-utils/windowApi';
import { resetLogDedupeForTests } from '../lib/logger';
import type { ExportPreview, FilterOptions } from '../../shared/types';
import { getPresetFilters } from '../lib/export-periods';
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
    exportHtml: vi.fn().mockResolvedValue({
      cancelled: false,
      htmlPath: 'C:\\reports\\usage.html',
      summaryRows: 2,
      sessionRows: 2,
    }),
  });
});

describe('ExportPage', () => {
  it('renders the preview cards and exports the current filters in an HTML report', async () => {
    const user = userEvent.setup();

    render(<ExportPage options={options} />);

    expect(await screen.findByText('6.00')).toBeInTheDocument();
    expect(screen.getByText('225')).toBeInTheDocument();
    expect(screen.getAllByText('Requests').length).toBeGreaterThan(0);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getAllByText('50.00%')).toHaveLength(2);
    expect(screen.getByText('2026-09-01')).toBeInTheDocument();
    expect(screen.getByText('2026-09-03')).toBeInTheDocument();

    const exportButton = screen.getByRole('button', { name: 'Export HTML report' });
    expect(exportButton).toBeEnabled();

    await user.click(exportButton);

    expect(window.api.exportHtml).toHaveBeenCalledWith({
      filters: {},
      suggestedName: 'copilot-usage.html',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/usage\.html \(2 summary rows, 2 session rows\)\./);
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
    expect(screen.getByRole('button', { name: 'Export HTML report' })).toBeDisabled();
  });

  it('shows a validation message and does not request another preview for an invalid custom range', async () => {
    render(<ExportPage options={options} />);

    await screen.findByText('6.00');
    expect(window.api.getExportPreview).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-01' } });
    await waitFor(() => expect(window.api.getExportPreview).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-07' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Start date must be on or before end date.');
    expect(screen.getByRole('button', { name: 'Export HTML report' })).toBeDisabled();
    expect(window.api.getExportPreview).toHaveBeenCalledTimes(2);
  });

  it('shows a retryable preview error when loading the report fails', async () => {
    window.api.getExportPreview = vi
      .fn()
      .mockRejectedValueOnce(new Error('preview failed'))
      .mockResolvedValueOnce(preview);
    const user = userEvent.setup();

    render(<ExportPage options={options} />);

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the export preview.");

    await user.click(screen.getByRole('button', { name: 'Retry preview' }));

    expect(await screen.findByText('6.00')).toBeInTheDocument();
    expect(window.api.getExportPreview).toHaveBeenCalledTimes(2);
  });

  it('hides stale preview content after a refreshed preview request fails', async () => {
    window.api.getExportPreview = vi
      .fn()
      .mockResolvedValueOnce(preview)
      .mockRejectedValueOnce(new Error('refresh failed'));
    const user = userEvent.setup();

    render(<ExportPage options={options} />);

    expect(await screen.findByText('6.00')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Model'), 'gpt-5.4');

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the export preview.");
    expect(screen.queryByText('6.00')).not.toBeInTheDocument();
    expect(screen.queryByText('Usage by model')).not.toBeInTheDocument();
    expect(screen.queryByText('2026-09-01')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export HTML report' })).toBeDisabled();
  });

  it('shows an export error alert when the HTML export fails', async () => {
    const boom = new Error('disk full');
    window.api.exportHtml = vi.fn().mockRejectedValue(boom);
    const logError = vi.spyOn(logger, 'logError').mockImplementation(() => undefined);
    const user = userEvent.setup();

    render(<ExportPage options={options} />);

    await user.click(await screen.findByRole('button', { name: 'Export HTML report' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not export the HTML report. Please try again.',
    );
    expect(logError).toHaveBeenCalledWith('ExportPage', 'HTML export failed', boom);
  });

  it('does not show a success message when the export is cancelled', async () => {
    window.api.exportHtml = vi.fn().mockResolvedValue({ cancelled: true });
    const user = userEvent.setup();

    render(<ExportPage options={options} />);

    await user.click(await screen.findByRole('button', { name: 'Export HTML report' }));

    await waitFor(() => expect(window.api.exportHtml).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/usage\.html/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('restores the matching preset after manual date edits and preserves project/model filters', async () => {
    const matchingRange = getPresetFilters('last-7-days', new Date(), options);

    render(<ExportPage options={options} />);

    await screen.findByText('6.00');

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'org/repo-a' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-5.4' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: matchingRange.from } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: matchingRange.to } });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(screen.getByRole('button', { name: 'All dates' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Previous month' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Export HTML report' }));

    await waitFor(() =>
      expect(window.api.exportHtml).toHaveBeenCalledWith({
        filters: {
          project: 'org/repo-a',
          model: 'gpt-5.4',
          from: matchingRange.from,
          to: matchingRange.to,
        },
        suggestedName: 'copilot-usage.html',
      }),
    );
  });
});
