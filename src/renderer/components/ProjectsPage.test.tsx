import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectsPage } from './ProjectsPage';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');

  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <actual.ResponsiveContainer width={600} height={240}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

describe('ProjectsPage', () => {
  it('renders derived summary values, the chart, and the table', () => {
    render(
      <ProjectsPage
        byProject={[
          { key: 'org/repo-a', aiuCredits: 3 },
          { key: 'org/repo-b', aiuCredits: 1 },
        ]}
        onProjectClick={vi.fn()}
      />,
    );

    expect(screen.getByText('2')).toBeInTheDocument(); // count of projects
    expect(screen.getByText('4.00')).toBeInTheDocument(); // total credits
    expect(screen.getAllByText('org/repo-a').length).toBeGreaterThan(0); // top project appears (chart/table/card)
    expect(screen.getByText('Credits by project')).toBeInTheDocument();
  });

  it('renders an empty state without crashing when there are no projects', () => {
    render(<ProjectsPage byProject={[]} onProjectClick={vi.fn()} />);

    // Use getAllByText with index selector since recharts creates a measurement span with '0'
    const zeroElements = screen.getAllByText('0');
    expect(zeroElements.length).toBeGreaterThan(0);
    expect(screen.getByText('No data for this selection.')).toBeInTheDocument();
  });

  it('calls onProjectClick when a chart bar is clicked', () => {
    const onProjectClick = vi.fn();
    const { container } = render(
      <ProjectsPage
        byProject={[
          { key: 'org/repo-a', aiuCredits: 3 },
          { key: 'org/repo-b', aiuCredits: 1 },
        ]}
        onProjectClick={onProjectClick}
      />,
    );

    const bar = container.querySelector('.recharts-bar-rectangle');
    expect(bar).not.toBeNull();
    fireEvent.click(bar as Element);

    expect(onProjectClick).toHaveBeenCalledWith('org/repo-a');
  });
});
