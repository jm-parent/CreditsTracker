import { useState } from 'react';
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

function FilterBarHarness({
  onChange,
  showProjectFilter = true,
}: {
  onChange: (filters: UsageFilters) => void;
  showProjectFilter?: boolean;
}) {
  const [filters, setFilters] = useState<UsageFilters>({});

  return (
    <FilterBar
      options={options}
      filters={filters}
      onChange={(next) => {
        setFilters(next);
        onChange(next);
      }}
      showProjectFilter={showProjectFilter}
    />
  );
}

describe('FilterBar', () => {
  it('renders a project path input and the model options', () => {
    render(<FilterBarHarness onChange={vi.fn()} />);

    expect(screen.getByLabelText('Project path')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search project path')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gpt-5.4' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'org/repo-a' })).not.toBeInTheDocument();
  });

  it('emits the project path search on every text change and clears it', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBarHarness onChange={onChange} />);

    const input = screen.getByLabelText('Project path');
    await user.type(input, 'repo-a');
    expect(onChange).toHaveBeenLastCalledWith({ projectSearch: 'repo-a' });

    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('does not keep a whitespace-only search filter', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBarHarness onChange={onChange} />);

    await user.type(screen.getByLabelText('Project path'), '   ');
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('hides the project path input when showProjectFilter is false', () => {
    render(<FilterBarHarness onChange={vi.fn()} showProjectFilter={false} />);

    expect(screen.queryByLabelText('Project path')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toBeInTheDocument();
  });

  it('calls onChange with the updated model when a model is selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBarHarness onChange={onChange} showProjectFilter={false} />);

    await user.selectOptions(screen.getByLabelText('Model'), 'gpt-5.4');

    expect(onChange).toHaveBeenCalledWith({ model: 'gpt-5.4' });
  });
});
