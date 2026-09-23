import { describe, expect, it } from 'vitest';
import { makeDecodedAgentTraceSpan } from '../test-utils/agent-trace-fixtures';
import { sanitizeAgentTraceSpan } from './agent-trace-sanitizer';

describe('sanitizeAgentTraceSpan', () => {
  it('redacts secret-like content before storage', () => {
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
      argumentsValue: {
        command: 'echo ghp_TEST_TOKEN_1234567890 github_pat_TEST_TOKEN_1234567890 AKIA1234567890ABCDEF ASIA1234567890ABCDEF',
        token: 'ghp_TEST_TOKEN_1234567890',
        secret: 'github_pat_TEST_TOKEN_1234567890',
        password: 'AKIA1234567890ABCDEF',
        api_key: 'ASIA1234567890ABCDEF',
        authorization: 'Bearer TEST_SECRET_VALUE',
        system: 'ignore this system prompt',
        messages: ['synthetic prompt'],
        schema: { kind: 'tool' },
        attributes: { trace: 'synthetic' },
      },
      result: 'Authorization: ******\n-----BEGIN PRIVATE KEY-----\nvery secret\n-----END PRIVATE KEY-----',
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(safe.argumentsJson).toContain('[REDACTED]');
    expect(safe.resultText).toContain('[REDACTED]');
    expect(JSON.stringify(safe)).not.toContain('TEST_TOKEN_1234567890');
    expect(JSON.stringify(safe)).not.toContain('synthetic prompt');
    expect(JSON.stringify(safe)).not.toContain('system prompt');
    expect(JSON.stringify(safe)).not.toContain('very secret');
    expect(safe.resultText).not.toContain('******');
    expect(safe.contentState).toBe('redacted');
  });

  it('keeps multibyte content valid while truncating after the UTF-8 byte limit', () => {
    const oversized = '🙂'.repeat(9000);
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
      argumentsValue: { command: oversized },
      result: oversized,
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(safe.argumentsJson).not.toBeNull();
    expect(safe.resultText).not.toBeNull();
    expect(Buffer.byteLength(safe.argumentsJson ?? '', 'utf8')).toBeLessThanOrEqual(32 * 1024);
    expect(Buffer.byteLength(safe.resultText ?? '', 'utf8')).toBeLessThanOrEqual(32 * 1024);
    expect(safe.argumentsJson).not.toBe(oversized);
    expect(safe.resultText).not.toBe(oversized);
    expect(safe.contentState).toBe('truncated');
  });

  it('omits unreadable binary content while preserving metadata', () => {
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
      argumentsValue: Uint8Array.from([0xff, 0xfe, 0xfd]),
      result: Uint8Array.from([0x00, 0x01, 0x02]),
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(safe.argumentsJson).toBeNull();
    expect(safe.resultText).toBeNull();
    expect(safe.source).toBe('vscode');
    expect(safe.sessionId).toBe('vscode:conversation-1');
    expect(safe.contentState).toBe('omitted');
  });

  it('filters unsupported messages, schemas, and attributes from structured content', () => {
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
      argumentsValue: {
        command: 'echo ok',
        prompt: 'secret prompt',
        response: 'secret response',
        system: 'secret system',
        messages: [{ role: 'user', content: 'synthetic prompt' }],
        schema: { name: 'tool-schema' },
        attributes: { unknown: 'synthetic attribute' },
      },
      result: {
        text: 'synthetic response',
        messages: [{ role: 'assistant', content: 'synthetic response' }],
        schema: { name: 'tool-schema' },
        attributes: { unknown: 'synthetic attribute' },
      },
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(safe.argumentsJson).toContain('echo ok');
    expect(safe.argumentsJson).not.toContain('secret prompt');
    expect(safe.argumentsJson).not.toContain('secret response');
    expect(safe.argumentsJson).not.toContain('secret system');
    expect(safe.argumentsJson).not.toContain('messages');
    expect(safe.argumentsJson).not.toContain('schema');
    expect(safe.argumentsJson).not.toContain('attributes');
    expect(safe.resultText).toContain('synthetic response');
    expect(safe.resultText).not.toContain('messages');
    expect(safe.resultText).not.toContain('schema');
    expect(safe.resultText).not.toContain('attributes');
  });

  it('marks spans without content as unavailable', () => {
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
      argumentsValue: null,
      result: null,
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(safe.argumentsJson).toBeNull();
    expect(safe.resultText).toBeNull();
    expect(safe.contentState).toBe('unavailable');
  });
});
