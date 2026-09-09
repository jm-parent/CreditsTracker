import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '../lib/logger';

interface ErrorBoundaryProps {
  /** Name of the guarded area, used as the log scope. */
  scope: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time exceptions from a page so a single broken screen shows
 * an explicit message (and a log entry) instead of blanking the whole app.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logError(this.props.scope, `Rendering failed: ${error.message}`, `${error.stack ?? error}\n${info.componentStack ?? ''}`);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (prevProps.scope !== this.props.scope && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="error-boundary rounded-md border border-border bg-muted p-6">
        <h2 className="text-lg font-semibold text-foreground">This page failed to render.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The error was recorded — open the Logs page to see the details.
        </p>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
          {error.message}
        </pre>
      </div>
    );
  }
}
