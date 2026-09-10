import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CreditDropLabel } from './CreditDropLabel';

describe('CreditDropLabel', () => {
  it('renders a positive delta label with the expected geometry and accessibility attrs', () => {
    const { container } = render(
      <svg>
        <CreditDropLabel
          x={20}
          y={40}
          width={30}
          change={{ delta: 2.5, animationKey: 4 }}
          color="#f97316"
          offsetX={3}
        />
      </svg>,
    );

    const label = container.querySelector('[data-credit-drop="true"]');

    expect(label).toHaveTextContent('+2.50');
    expect(label).toHaveAttribute('fill', '#f97316');
    expect(label).toHaveAttribute('x', '38');
    expect(label).toHaveAttribute('y', '34');
    expect(label).toHaveAttribute('aria-hidden', 'true');
    expect(label).toHaveAttribute('pointer-events', 'none');
    expect(label).toHaveClass('credit-drop-positive');
  });

  it('renders a negative delta label in orange and uses the fade class', () => {
    const { container } = render(
      <svg>
        <CreditDropLabel
          x={0}
          y={18}
          width={10}
          change={{ delta: -1.5, animationKey: 7 }}
          color="#22d3ee"
        />
      </svg>,
    );

    const renderedNegative = container.querySelector('[data-credit-drop="true"]');

    expect(renderedNegative).toHaveTextContent('−1.50');
    expect(renderedNegative).toHaveAttribute('fill', '#fb923c');
    expect(renderedNegative).toHaveClass('credit-drop-negative');
  });

  it('returns null when no change is available', () => {
    const { container } = render(
      <svg>
        <CreditDropLabel x={10} y={20} width={30} color="#22d3ee" />
      </svg>,
    );

    expect(container.querySelector('text')).toBeNull();
  });

  it('returns null for invalid Recharts geometry instead of rendering NaN coordinates', () => {
    const { container } = render(
      <svg>
        <CreditDropLabel
          x="not-a-number"
          y={20}
          width={30}
          change={{ delta: 1, animationKey: 1 }}
          color="#22d3ee"
        />
      </svg>,
    );

    expect(container.querySelector('text')).toBeNull();
  });
});
