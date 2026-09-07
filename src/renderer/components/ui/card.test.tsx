import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardContent } from './card';

describe('Card', () => {
  it('renders a title and content together', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Example title</CardTitle>
        </CardHeader>
        <CardContent>Example content</CardContent>
      </Card>,
    );

    expect(screen.getByText('Example title')).toBeInTheDocument();
    expect(screen.getByText('Example content')).toBeInTheDocument();
  });
});
