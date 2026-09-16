export type FeaturedProjectIcon =
  | 'gauge'
  | 'sparkles'
  | 'focus'
  | 'wand'
  | 'workflow'
  | 'shield'
  | 'brain'
  | 'terminal'
  | 'file';

export interface FeaturedProject {
  id: string;
  repository: string;
  url: string;
  title: string;
  description: string;
  icon: FeaturedProjectIcon;
  tags: string[];
}

export const FEATURED_PROJECTS: readonly FeaturedProject[] = [
  {
    id: 'rtk',
    repository: 'rtk-ai/rtk',
    url: 'https://github.com/rtk-ai/rtk',
    title: 'RTK',
    description: 'A Rust CLI proxy that reduces LLM token consumption for common development commands.',
    icon: 'gauge',
    tags: ['AI coding', 'Developer tools', 'Performance'],
  },
  {
    id: 'superpowers',
    repository: 'obra/superpowers',
    url: 'https://github.com/obra/superpowers',
    title: 'Superpowers',
    description: 'An agentic skills framework and software development methodology for structured coding work.',
    icon: 'sparkles',
    tags: ['AI coding', 'Workflow', 'Skills'],
  },
  {
    id: 'i-have-adhd',
    repository: 'ayghri/i-have-adhd',
    url: 'https://github.com/ayghri/i-have-adhd',
    title: 'I Have ADHD',
    description: 'An ADHD-friendly coding-agent skill that keeps answers visible, focused, and actionable.',
    icon: 'focus',
    tags: ['AI coding', 'Productivity', 'Accessibility'],
  },
  {
    id: 'ponytail',
    repository: 'DietrichGebert/ponytail',
    url: 'https://github.com/DietrichGebert/ponytail',
    title: 'Ponytail',
    description: 'A pragmatic coding-agent approach that avoids unnecessary implementation and favors simple solutions.',
    icon: 'wand',
    tags: ['AI coding', 'Productivity', 'Developer tools'],
  },
  {
    id: 'archify',
    repository: 'tt-a1i/archify',
    url: 'https://github.com/tt-a1i/archify',
    title: 'Archify',
    description: 'An agent skill for producing beautiful, verifiable architecture, workflow, sequence, data-flow, and lifecycle diagrams.',
    icon: 'workflow',
    tags: ['AI coding', 'Architecture', 'Visualization'],
  },
  {
    id: 'ecc',
    repository: 'affaan-m/ECC',
    url: 'https://github.com/affaan-m/ECC',
    title: 'Everything Claude Code',
    description: 'An agent-harness optimization system combining skills, instincts, memory, security, and research-first development.',
    icon: 'shield',
    tags: ['AI coding', 'Developer tools', 'Workflow'],
  },
  {
    id: 'open-code-review',
    repository: 'alibaba/open-code-review',
    url: 'https://github.com/alibaba/open-code-review',
    title: 'Open Code Review',
    description: 'A hybrid deterministic and LLM-assisted code-review tool with line-level feedback and multi-language rules.',
    icon: 'brain',
    tags: ['Code review', 'Security', 'AI coding'],
  },
  {
    id: 'kiro',
    repository: 'kirodotdev/Kiro',
    url: 'https://github.com/kirodotdev/Kiro',
    title: 'Kiro',
    description: 'An agentic IDE designed to support software work from prototype through production.',
    icon: 'terminal',
    tags: ['AI coding', 'IDE', 'Spec-driven'],
  },
  {
    id: 'spec-kit',
    repository: 'github/spec-kit',
    url: 'https://github.com/github/spec-kit',
    title: 'Spec Kit',
    description: 'A toolkit for getting started with spec-driven development.',
    icon: 'file',
    tags: ['Spec-driven', 'Developer tools', 'AI coding'],
  },
  {
    id: 'strix',
    repository: 'usestrix/strix',
    url: 'https://github.com/usestrix/strix',
    title: 'Strix',
    description: 'An open-source AI penetration testing tool that finds and fixes application vulnerabilities.',
    icon: 'shield',
    tags: ['AI coding', 'Security', 'Developer tools'],
  },
  {
    id: 'headroom',
    repository: 'headroomlabs-ai/headroom',
    url: 'https://github.com/headroomlabs-ai/headroom',
    title: 'Headroom',
    description: 'A compression layer for tool outputs, logs, files, and RAG chunks before they reach the LLM.',
    icon: 'gauge',
    tags: ['AI coding', 'Developer tools', 'Performance'],
  },
];
