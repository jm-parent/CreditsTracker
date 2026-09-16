import { useState } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a project path input and the model options', () => {
    render(<FilterBarHarness onChange={vi.fn()} />);

    expect(screen.getByLabelText('Project path')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search project path')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gpt-5.4' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'org/repo-a' })).not.toBeInTheDocument();
  });

  it('debounces project path search until typing pauses', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<FilterBarHarness onChange={onChange} />);

    const input = screen.getByLabelText('Project path');
    fireEvent.change(input, { target: { value: 'r' } });
    fireEvent.change(input, { target: { value: 'repo-a' } });

    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(299));
    expect(onChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenLastCalledWith({ projectSearch: 'repo-a' });
  });

  it('debounces clearing the project path search', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<FilterBarHarness onChange={onChange} />);

    const input = screen.getByLabelText('Project path');
    fireEvent.change(input, { target: { value: 'repo-a' } });
    fireEvent.change(input, { target: { value: '' } });

    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('does not keep a whitespace-only search filter', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<FilterBarHarness onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Project path'), { target: { value: '   ' } });
    act(() => vi.advanceTimersByTime(300));
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
