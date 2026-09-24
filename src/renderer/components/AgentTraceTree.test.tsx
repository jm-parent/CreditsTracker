import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeAgentTraceSpan } from '../../test-utils/agent-trace-fixtures';
import type { AgentTraceSession } from '../../shared/types';
import { AgentTraceTree } from './AgentTraceTree';

function makeSession(): AgentTraceSession {
  return {
    source: 'vscode',
    sessionId: 'vscode:conversation-1',
    availability: 'partial',
    spans: [
      makeAgentTraceSpan({
        traceId: 'trace-1',
        spanId: 'root',
        category: 'agent',
        name: 'invoke_agent copilot',
        model: 'gpt-5.4',
        startedAt: '2026-09-23T10:00:00.000Z',
        durationMs: 1_000,
      }),
      makeAgentTraceSpan({
        traceId: 'trace-1',
        spanId: 'llm-1',
        parentSpanId: 'root',
        category: 'llm',
        name: 'chat turn',
        toolCallId: 'call-7',
        argumentsJson: 'prompt body should stay hidden',
        resultText: 'model answer should stay hidden',
        startedAt: '2026-09-23T10:00:00.050Z',
        durationMs: 700,
      }),
      makeAgentTraceSpan({
        traceId: 'trace-1',
        spanId: 'shell-1',
        parentSpanId: 'root',
        category: 'shell',
        name: 'execute_tool runCommand',
        toolName: 'runCommand',
        argumentsJson: '{"command":"echo <script>alert(1)</script>"}',
        resultText: 'done',
        contentState: 'stored',
        startedAt: '2026-09-23T10:00:00.080Z',
        durationMs: 200,
      }),
      makeAgentTraceSpan({
        traceId: 'trace-1',
        spanId: 'tool-1',
        parentSpanId: null,
        category: 'tool',
        name: 'execute_tool readFile',
        toolName: 'readFile',
        toolCallId: 'call-7',
        argumentsJson: '{"path":"README.md"}',
        resultText: 'file contents',
        contentState: 'redacted-truncated',
        startedAt: '2026-09-23T10:00:00.120Z',
        durationMs: 150,
        status: 'error',
        errorType: 'TimeoutError',
      }),
      makeAgentTraceSpan({
        traceId: 'trace-1',
        spanId: 'orphan',
        parentSpanId: 'missing-parent',
        category: 'tool',
        name: 'execute_tool listFiles',
        toolName: 'listFiles',
        argumentsJson: null,
        resultText: null,
        contentState: 'omitted',
        startedAt: '2026-09-23T10:00:00.300Z',
        durationMs: 60,
      }),
      makeAgentTraceSpan({
        traceId: 'trace-2',
        spanId: 'root-2',
        category: 'agent',
        name: 'invoke_agent follow-up',
        skillName: 'agent-call-traces',
        startedAt: '2026-09-23T10:05:00.000Z',
        durationMs: 300,
        contentState: 'unavailable',
        argumentsJson: null,
        resultText: null,
      }),
    ],
  };
}

describe('AgentTraceTree', () => {
  it('renders an accessible tree with collapsed content by default and toggles details on demand', () => {
    render(<AgentTraceTree session={makeSession()} />);

    expect(screen.getByRole('tree', { name: 'Agent trace spans' })).toBeInTheDocument();
    expect(screen.getByText('Partial trace')).toBeInTheDocument();
    expect(screen.getByText('trace-1')).toBeInTheDocument();
    expect(screen.getByText('trace-2')).toBeInTheDocument();

    const shellButton = screen.getByRole('button', { name: /execute_tool runCommand/i });
    expect(shellButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('{"command":"echo <script>alert(1)</script>"}')).not.toBeInTheDocument();

    fireEvent.click(shellButton);

    expect(shellButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('{"command":"echo <script>alert(1)</script>"}')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('shows timing, status, and content-state labels without rendering llm prompt or response content', () => {
    render(<AgentTraceTree session={makeSession()} />);

    fireEvent.click(screen.getByRole('button', { name: /execute_tool readFile/i }));

    const traceOne = screen.getByTestId('agent-trace-turn-trace-1');
    expect(within(traceOne).getByText('+80 ms')).toBeInTheDocument();
    expect(within(traceOne).getByText('200 ms')).toBeInTheDocument();
    expect(within(traceOne).getByText('150 ms')).toBeInTheDocument();
    expect(within(traceOne).getByText('error')).toBeInTheDocument();
    expect(within(traceOne).getByText('TimeoutError')).toBeInTheDocument();
    expect(within(traceOne).getAllByText('stored').length).toBeGreaterThan(0);
    expect(within(traceOne).getByText('redacted-truncated')).toBeInTheDocument();
    expect(within(traceOne).getByText('omitted')).toBeInTheDocument();
    expect(screen.getByText('agent-call-traces')).toBeInTheDocument();

    expect(screen.queryByText('prompt body should stay hidden')).not.toBeInTheDocument();
    expect(screen.queryByText('model answer should stay hidden')).not.toBeInTheDocument();
  });
});
