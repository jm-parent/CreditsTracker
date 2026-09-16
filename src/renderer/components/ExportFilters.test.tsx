import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportFilters } from './ExportFilters';
import type { FilterOptions } from '../../shared/types';

const options: FilterOptions = {
  projects: ['org/repo-a'],
  models: ['claude-sonnet-5'],
  minDate: '2026-09-01',
  maxDate: '2026-09-07',
};

describe('ExportFilters', () => {
  it('renders the export filter controls with preset shortcuts', async () => {
    const onFiltersChange = vi.fn();
    const onPresetChange = vi.fn();
    const user = userEvent.setup();

    render(
      <ExportFilters
        options={options}
        filters={{ project: 'org/repo-a', model: 'claude-sonnet-5', from: '2026-09-02', to: '2026-09-07' }}
        preset="all"
        onFiltersChange={onFiltersChange}
        onPresetChange={onPresetChange}
      />,
    );

    expect(screen.getByLabelText('Project')).toHaveAttribute('id', 'export-project-filter');
    expect(screen.getByLabelText('Model')).toHaveAttribute('id', 'export-model-filter');
    expect(screen.getByLabelText('From')).toHaveAttribute('id', 'export-from');
    expect(screen.getByLabelText('To')).toHaveAttribute('id', 'export-to');
    expect(screen.getByRole('option', { name: 'All projects' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All models' })).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toHaveAttribute('min', '2026-09-01');
    expect(screen.getByLabelText('To')).toHaveAttribute('max', '2026-09-07');
    expect(screen.getByRole('button', { name: 'All dates' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Previous month' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'Last 7 days' }));

    expect(onPresetChange).toHaveBeenCalledWith('last-7-days');
    expect(onFiltersChange).not.toHaveBeenCalled();
  });

  it('preserves the other selected fields when a date changes', async () => {
    const onFiltersChange = vi.fn();

    render(
      <ExportFilters
        options={options}
        filters={{ project: 'org/repo-a', model: 'claude-sonnet-5', from: '2026-09-02', to: '2026-09-07' }}
        preset="this-month"
        onFiltersChange={onFiltersChange}
        onPresetChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-03' } });

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      project: 'org/repo-a',
      model: 'claude-sonnet-5',
      from: '2026-09-03',
      to: '2026-09-07',
    });
  });
});
