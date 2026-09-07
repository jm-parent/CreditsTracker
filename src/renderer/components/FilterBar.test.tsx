import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from './FilterBar';
import type { FilterOptions, UsageFilters } from '../../shared/types';

const options: FilterOptions = {
  projects: ['org/repo-a', 'org/repo-b'],
  models: ['claude-sonnet-5', 'gpt-5.4'],
  minDate: '2026-09-01',
  maxDate: '2026-09-07',
};

describe('FilterBar', () => {
  it('renders project and model options, plus date inputs', () => {
    render(<FilterBar options={options} filters={{}} onChange={vi.fn()} />);

    expect(screen.getByRole('option', { name: 'org/repo-a' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gpt-5.4' })).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });

  it('calls onChange with the updated project when a project is selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar options={options} filters={{}} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText('Project'), 'org/repo-b');

    expect(onChange).toHaveBeenCalledWith({ project: 'org/repo-b' });
  });

  it('calls onChange with the updated date when "From" changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar options={options} filters={{ project: 'org/repo-a' }} onChange={onChange} />);

    await user.type(screen.getByLabelText('From'), '2026-09-02');

    expect(onChange).toHaveBeenLastCalledWith({ project: 'org/repo-a', from: '2026-09-02' });
  });
});
