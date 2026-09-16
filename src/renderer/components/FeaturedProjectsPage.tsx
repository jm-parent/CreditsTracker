import { useState } from 'react';
import {
  Brain,
  ExternalLink,
  FileText,
  Focus,
  Gauge,
  ShieldCheck,
  Sparkles,
  Terminal,
  WandSparkles,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { FEATURED_PROJECTS } from '../data/featuredProjects';
import type { FeaturedProject, FeaturedProjectIcon } from '../data/featuredProjects';
import { logError } from '../lib/logger';
import { Badge } from './ui/badge';
import { Card } from './ui/card';

const ICONS: Record<FeaturedProjectIcon, LucideIcon> = {
  gauge: Gauge,
  sparkles: Sparkles,
  focus: Focus,
  wand: WandSparkles,
  workflow: Workflow,
  shield: ShieldCheck,
  brain: Brain,
  terminal: Terminal,
  file: FileText,
};

interface FeaturedProjectsPageProps {
  projects?: readonly FeaturedProject[];
}

export function FeaturedProjectsPage({
  projects = FEATURED_PROJECTS,
}: FeaturedProjectsPageProps) {
  const [activeTag, setActiveTag] = useState('All');
  const [openError, setOpenError] = useState<string | null>(null);
  const tags = Array.from(new Set(projects.flatMap((project) => project.tags)));
  const visibleProjects = activeTag === 'All'
    ? projects
    : projects.filter((project) => project.tags.includes(activeTag));

  async function handleOpen(project: FeaturedProject): Promise<void> {
    setOpenError(null);
    try {
      await window.api.openExternalUrl(project.url);
    } catch (error) {
      logError('FeaturedProjectsPage', `Failed to open ${project.repository}`, error);
      setOpenError('Could not open this GitHub repository. Please try again.');
    }
  }

  return (
    <section className="featured-projects-page flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-foreground">Featured projects</h2>
        <p className="text-sm text-muted-foreground">
          Curated GitHub projects for better AI-assisted development.
        </p>
      </header>

      <div
        role="group"
        aria-label="Filter featured projects"
        className="flex flex-wrap gap-2"
      >
        {['All', ...tags].map((tag) => (
          <button
            key={tag}
            type="button"
            aria-pressed={activeTag === tag}
            onClick={() => setActiveTag(tag)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              activeTag === tag
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-foreground hover:bg-muted'
            }`}
          >
            {tag}
          </button>
        ))}
      </div>

      {openError && (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
          {openError}
        </p>
      )}

      {visibleProjects.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No featured projects match this tag.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => {
            const Icon = ICONS[project.icon];
            return (
              <Card
                key={project.id}
                data-testid="featured-project-card"
                className="overflow-hidden transition-colors hover:border-primary/50"
              >
                <button
                  type="button"
                  aria-label={`Open ${project.repository} on GitHub`}
                  onClick={() => void handleOpen(project)}
                  className="flex h-full w-full flex-col gap-4 p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-md bg-primary/10 p-2 text-primary">
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="flex items-center gap-1 text-xs font-medium text-primary">
                      View on GitHub
                      <ExternalLink size={14} aria-hidden="true" />
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <h3 className="font-semibold text-foreground">{project.title}</h3>
                    <p className="text-xs text-muted-foreground">{project.repository}</p>
                  </div>
                  <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
                    {project.description}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {project.tags.map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </div>
                </button>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
