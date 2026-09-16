import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetLogDedupeForTests } from '../lib/logger';
import { FeaturedProjectsPage } from './FeaturedProjectsPage';

const openExternalUrl = vi.fn();
const log = vi.fn();

const expectedProjects = [
  {
    repository: 'rtk-ai/rtk',
    url: 'https://github.com/rtk-ai/rtk',
    title: 'RTK',
    description: 'A Rust CLI proxy that reduces LLM token consumption for common development commands.',
    iconClass: 'lucide-gauge',
    tags: ['AI coding', 'Developer tools', 'Performance'],
  },
  {
    repository: 'obra/superpowers',
    url: 'https://github.com/obra/superpowers',
    title: 'Superpowers',
    description: 'An agentic skills framework and software development methodology for structured coding work.',
    iconClass: 'lucide-sparkles',
    tags: ['AI coding', 'Workflow', 'Skills'],
  },
  {
    repository: 'ayghri/i-have-adhd',
    url: 'https://github.com/ayghri/i-have-adhd',
    title: 'I Have ADHD',
    description: 'An ADHD-friendly coding-agent skill that keeps answers visible, focused, and actionable.',
    iconClass: 'lucide-focus',
    tags: ['AI coding', 'Productivity', 'Accessibility'],
  },
  {
    repository: 'DietrichGebert/ponytail',
    url: 'https://github.com/DietrichGebert/ponytail',
    title: 'Ponytail',
    description: 'A pragmatic coding-agent approach that avoids unnecessary implementation and favors simple solutions.',
    iconClass: 'lucide-wand-sparkles',
    tags: ['AI coding', 'Productivity', 'Developer tools'],
  },
  {
    repository: 'tt-a1i/archify',
    url: 'https://github.com/tt-a1i/archify',
    title: 'Archify',
    description: 'An agent skill for producing beautiful, verifiable architecture, workflow, sequence, data-flow, and lifecycle diagrams.',
    iconClass: 'lucide-workflow',
    tags: ['AI coding', 'Architecture', 'Visualization'],
  },
  {
    repository: 'affaan-m/ECC',
    url: 'https://github.com/affaan-m/ECC',
    title: 'Everything Claude Code',
    description: 'An agent-harness optimization system combining skills, instincts, memory, security, and research-first development.',
    iconClass: 'lucide-shield-check',
    tags: ['AI coding', 'Developer tools', 'Workflow'],
  },
  {
    repository: 'alibaba/open-code-review',
    url: 'https://github.com/alibaba/open-code-review',
    title: 'Open Code Review',
    description: 'A hybrid deterministic and LLM-assisted code-review tool with line-level feedback and multi-language rules.',
    iconClass: 'lucide-brain',
    tags: ['Code review', 'Security', 'AI coding'],
  },
  {
    repository: 'kirodotdev/Kiro',
    url: 'https://github.com/kirodotdev/Kiro',
    title: 'Kiro',
    description: 'An agentic IDE designed to support software work from prototype through production.',
    iconClass: 'lucide-terminal',
    tags: ['AI coding', 'IDE', 'Spec-driven'],
  },
  {
    repository: 'github/spec-kit',
    url: 'https://github.com/github/spec-kit',
    title: 'Spec Kit',
    description: 'A toolkit for getting started with spec-driven development.',
    iconClass: 'lucide-file-text',
    tags: ['Spec-driven', 'Developer tools', 'AI coding'],
  },
] as const;

beforeEach(() => {
  resetLogDedupeForTests();
  openExternalUrl.mockReset().mockResolvedValue(undefined);
  log.mockReset().mockResolvedValue(undefined);
  window.api = { ...(window.api ?? {}), openExternalUrl, log } as typeof window.api;
});

describe('FeaturedProjectsPage', () => {
  it('renders the curated catalogue with its project details and accessible filters', () => {
    render(<FeaturedProjectsPage />);

    expect(screen.getByRole('heading', { name: 'Featured projects' })).toBeInTheDocument();
    expect(
      screen.getByText('Curated GitHub projects for better AI-assisted development.'),
    ).toBeInTheDocument();

    const filterGroup = screen.getByRole('group', { name: 'Filter featured projects' });
    expect(within(filterGroup).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'All',
      'AI coding',
      'Developer tools',
      'Performance',
      'Workflow',
      'Skills',
      'Productivity',
      'Accessibility',
      'Architecture',
      'Visualization',
      'Code review',
      'Security',
      'IDE',
      'Spec-driven',
    ]);
    expect(within(filterGroup).getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const cards = screen.getAllByTestId('featured-project-card');
    expect(cards).toHaveLength(9);
    expect(cards[0].parentElement).toHaveClass(
      'grid',
      'grid-cols-1',
      'gap-4',
      'md:grid-cols-2',
      'xl:grid-cols-3',
    );

    for (const project of expectedProjects) {
      const button = screen.getByRole('button', {
        name: `Open ${project.repository} on GitHub`,
      });
      const card = button.parentElement;

      expect(card).toHaveAttribute('data-testid', 'featured-project-card');
      expect(within(button).getByRole('heading', { name: project.title })).toBeInTheDocument();
      expect(within(button).getByText(project.repository)).toBeInTheDocument();
      expect(within(button).getByText(project.description)).toBeInTheDocument();
      for (const tag of project.tags) {
        expect(within(button).getByText(tag)).toBeInTheDocument();
      }
      expect(within(button).getByText('View on GitHub')).toBeVisible();
      expect(button.querySelector(`.${project.iconClass}`)).toHaveAttribute('aria-hidden', 'true');
      expect(button.querySelector('.lucide-external-link')).toHaveAttribute('aria-hidden', 'true');
      expect(card?.querySelectorAll('button')).toHaveLength(1);
      expect(card?.querySelector('a')).not.toBeInTheDocument();
    }
  });

  it('filters by one tag and restores every card with All', async () => {
    const user = userEvent.setup();
    render(<FeaturedProjectsPage />);

    await user.click(screen.getByRole('button', { name: 'Accessibility' }));

    expect(screen.getAllByTestId('featured-project-card')).toHaveLength(1);
    expect(screen.getByText('ayghri/i-have-adhd')).toBeInTheDocument();
    expect(screen.queryByText('rtk-ai/rtk')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accessibility' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'All' }));

    expect(screen.getAllByTestId('featured-project-card')).toHaveLength(9);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens a card using its exact canonical GitHub URL', async () => {
    const user = userEvent.setup();
    render(<FeaturedProjectsPage />);

    await user.click(screen.getByRole('button', { name: 'Open rtk-ai/rtk on GitHub' }));

    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/rtk-ai/rtk');
  });

  it('logs browser failures and shows feedback that clears before retrying', async () => {
    const user = userEvent.setup();
    openExternalUrl.mockRejectedValueOnce(new Error('browser unavailable'));
    render(<FeaturedProjectsPage />);

    const card = screen.getByRole('button', { name: 'Open rtk-ai/rtk on GitHub' });
    await user.click(card);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not open this GitHub repository. Please try again.',
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        scope: 'FeaturedProjectsPage',
        message: 'Failed to open rtk-ai/rtk',
      }),
    );

    openExternalUrl.mockResolvedValueOnce(undefined);
    await user.click(card);

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('shows an intentional empty state when the active filter has no matches', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FeaturedProjectsPage />);
    await user.click(screen.getByRole('button', { name: 'Accessibility' }));

    rerender(<FeaturedProjectsPage projects={[]} />);

    expect(screen.queryByTestId('featured-project-card')).not.toBeInTheDocument();
    expect(screen.getByText('No featured projects match this tag.')).toBeInTheDocument();
  });
});
