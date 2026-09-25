import type { AgentTraceSpan } from '../shared/types';
import type { DecodedAgentTraceSpan } from '../main/agent-trace-protocol';

const DEFAULT_TRACE_ID = '00112233445566778899aabbccddeeff';
const DEFAULT_SPAN_ID = '1111222233334444';
const DEFAULT_SESSION_ID = 'vscode:conversation-1';
const DEFAULT_STARTED_AT = '2026-01-01T00:00:00.000Z';
const DEFAULT_ENDED_AT = '2026-01-01T00:00:00.100Z';
const DEFAULT_STARTED_AT_NS = '1780000000000000000';
const DEFAULT_ENDED_AT_NS = '1780000000100000000';

export function makeAgentTraceSpan(overrides: Partial<AgentTraceSpan> = {}): AgentTraceSpan {
  return {
    source: 'vscode',
    sessionId: DEFAULT_SESSION_ID,
    traceId: DEFAULT_TRACE_ID,
    spanId: DEFAULT_SPAN_ID,
    parentSpanId: null,
    name: 'invoke_agent copilot',
    category: 'agent',
    toolName: null,
    skillName: null,
    model: 'gpt-5.4',
    startedAt: DEFAULT_STARTED_AT,
    endedAt: DEFAULT_ENDED_AT,
    durationMs: 100,
    status: 'ok',
    errorType: null,
    toolCallId: 'call-1',
    argumentsJson: '{"command":"echo trace-probe"}',
    resultText: 'trace-probe',
    contentState: 'stored',
    ...overrides,
  };
}

export function makeDecodedAgentTraceSpan(
  overrides: Partial<DecodedAgentTraceSpan> = {},
): DecodedAgentTraceSpan {
  return {
    source: 'vscode',
    sourceResolution: 'supported',
    conversationId: 'conversation-1',
    sessionId: DEFAULT_SESSION_ID,
    traceRootInRequest: true,
    spanSource: 'vscode',
    spanSourceResolution: 'supported',
    spanConversationId: 'conversation-1',
    spanParentConversationId: null,
    traceId: DEFAULT_TRACE_ID,
    spanId: DEFAULT_SPAN_ID,
    parentSpanId: null,
    name: 'invoke_agent copilot',
    category: 'agent',
    toolName: null,
    skillName: null,
    model: 'gpt-5.4',
    startedAtNs: DEFAULT_STARTED_AT_NS,
    endedAtNs: DEFAULT_ENDED_AT_NS,
    status: 'ok',
    errorType: null,
    toolCallId: 'call-1',
    argumentsValue: '{"command":"echo trace-probe"}',
    result: 'trace-probe',
    ...overrides,
  };
}
