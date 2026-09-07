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
  it('renders project and model options', () => {
    render(<FilterBar options={options} filters={{}} onChange={vi.fn()} />);

    expect(screen.getByRole('option', { name: 'org/repo-a' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gpt-5.4' })).toBeInTheDocument();
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
  });

  it('calls onChange with the updated project when a project is selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar options={options} filters={{}} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText('Project'), 'org/repo-b');

    expect(onChange).toHaveBeenCalledWith({ project: 'org/repo-b' });
  });

  it('hides the project filter when showProjectFilter is false', () => {
    render(<FilterBar options={options} filters={{}} onChange={vi.fn()} showProjectFilter={false} />);

    expect(screen.queryByLabelText('Project')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toBeInTheDocument();
  });

  it('calls onChange with the updated model when a model is selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar options={options} filters={{}} onChange={onChange} showProjectFilter={false} />);

    await user.selectOptions(screen.getByLabelText('Model'), 'gpt-5.4');

    expect(onChange).toHaveBeenCalledWith({ model: 'gpt-5.4' });
  });
});
