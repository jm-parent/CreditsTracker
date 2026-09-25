import { describe, expect, it } from 'vitest';
import { makeDecodedAgentTraceSpan } from '../test-utils/agent-trace-fixtures';
import {
  attributeAgentTraceSpan,
  sanitizeAgentTraceSpan,
  sanitizeUnattributedAgentTraceSpan,
} from './agent-trace-sanitizer';

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

  it('retains non-sensitive tool-specific fields while filtering excluded content categories', () => {
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
    argumentsValue: {
      command: 'echo ok',
      toolSpecificConfig: {
        mode: 'dry-run',
        retryCount: 2,
      },
      prompt: 'secret prompt',
      messages: [{ role: 'user', content: 'synthetic prompt' }],
      schema: { name: 'tool-schema' },
      attributes: { unknown: 'synthetic attribute' },
    },
    result: {
      toolSpecificResult: {
        accepted: true,
        reason: 'synthetic',
      },
      response: 'secret response',
      system: 'secret system',
      message: 'secret message',
      attributes: { unknown: 'synthetic attribute' },
    },
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(safe.argumentsJson).toContain('"toolSpecificConfig":{"mode":"dry-run","retryCount":2}');
    expect(safe.resultText).toContain('"toolSpecificResult":{"accepted":true,"reason":"synthetic"}');
    expect(safe.argumentsJson).toContain('echo ok');
    expect(safe.argumentsJson).not.toContain('secret prompt');
    expect(safe.argumentsJson).not.toContain('messages');
    expect(safe.argumentsJson).not.toContain('schema');
    expect(safe.argumentsJson).not.toContain('attributes');
    expect(safe.resultText).not.toContain('secret response');
    expect(safe.resultText).not.toContain('secret system');
    expect(safe.resultText).not.toContain('secret message');
    expect(safe.resultText).not.toContain('attributes');
    expect(safe.contentState).toBe('redacted');
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

  it.each([
    ['an environment token assignment', 'GITHUB_TOKEN=synthetic-value-01', 'GITHUB_TOKEN=[REDACTED]'],
    ['a prefixed password assignment', 'DB_PASSWORD=synthetic-value-02', 'DB_PASSWORD=[REDACTED]'],
    ['a prefixed API key assignment', 'OPENAI_API_KEY=synthetic-value-03', 'OPENAI_API_KEY=[REDACTED]'],
    ['a secret with a suffix', 'AWS_SECRET_ACCESS_KEY=synthetic-value-04', 'AWS_SECRET_ACCESS_KEY=[REDACTED]'],
    ['a YAML-style client secret', 'client_secret: synthetic-value-05', 'client_secret: [REDACTED]'],
    [
      'a quoted password inside text that is not JSON',
      'config dump -> "password": "synthetic-value-06", "user": "bob"',
      '"password": "[REDACTED]", "user": "bob"',
    ],
    ['an authorization assignment', 'authorization=synthetic-value-07', 'authorization=[REDACTED]'],
    ['a camel-case key in text', 'accessToken: synthetic-value-08', 'accessToken: [REDACTED]'],
    ['a header-style API key', 'x-api-key: synthetic-value-09', 'x-api-key: [REDACTED]'],
    ['a PowerShell environment assignment', '$env:GITHUB_TOKEN = "synthetic-value-10"', '$env:GITHUB_TOKEN = "[REDACTED]"'],
    ['an exported quoted key', "export OPENAI_API_KEY='synthetic-value-11'", "export OPENAI_API_KEY='[REDACTED]'"],
    ['a command-line password flag', 'mysql --password synthetic-value-12 -h db', 'mysql --password [REDACTED] -h db'],
    ['URL credentials', 'git remote -v https://user:synthetic-value-13@example.com/repo.git', 'https://user:[REDACTED]@example.com'],
    ['a cookie header', 'Cookie: sid=synthetic-value-14; theme=synthetic-value-15', 'Cookie: [REDACTED]'],
    ['an escaped JSON password', String.raw`{\"password\":\"synthetic-value-16\"}`, String.raw`{\"password\":[REDACTED]`],
  ])('redacts %s from text payloads', (_label, input, expected) => {
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
      argumentsValue: null,
      result: input,
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(safe.resultText).toContain(expected);
    expect(safe.resultText).not.toMatch(/synthetic-value-\d+/);
    expect(safe.contentState).toBe('redacted');
  });

  it('redacts a standalone bearer credential with the redaction marker', () => {
    const scheme = ['Bear', 'er'].join('');
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
      argumentsValue: null,
      result: `curl -H "X-Custom: ${scheme} synthetic-value-17" https://example.com`,
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(safe.resultText).toContain(`${scheme} [REDACTED]`);
    expect(safe.resultText).not.toContain('synthetic-value-17');
    expect(safe.contentState).toBe('redacted');
  });

  it('normalizes structured keys and sanitizes JSON nested inside JSON strings', () => {
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
      argumentsValue: {
        apiKey: 'synthetic-value-18',
        'Client-Secret': 'synthetic-value-19',
        private_key: 'synthetic-value-20',
        auth: 'synthetic-value-21',
        input: JSON.stringify({ password: 'synthetic-value-22', command: 'echo ok' }),
        nestedText: JSON.stringify({ note: 'GITHUB_TOKEN=synthetic-value-23' }),
        command: 'echo ok',
      },
      result: JSON.stringify({ stdout: JSON.stringify({ accessToken: 'synthetic-value-24' }) }),
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(JSON.stringify(safe)).not.toMatch(/synthetic-value-\d+/);
    expect(safe.argumentsJson).toContain('"apiKey":"[REDACTED]"');
    expect(safe.argumentsJson).toContain('"Client-Secret":"[REDACTED]"');
    expect(safe.argumentsJson).toContain('"private_key":"[REDACTED]"');
    expect(safe.argumentsJson).toContain('"auth":"[REDACTED]"');
    expect(safe.argumentsJson).toContain('echo ok');
    expect(safe.contentState).toBe('redacted');
  });

  it.each([
    ['a private key header without its footer', '-----BEGIN RSA PRIVATE KEY-----\nMIIEsyntheticvalue25'],
    ['a private key footer without its header', 'MIIEsyntheticvalue26\n-----END OPENSSH PRIVATE KEY-----'],
  ])('omits all content when it contains %s', (_label, keyMaterial) => {
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
      argumentsValue: { command: 'cat id_rsa' },
      result: `head of file\n${keyMaterial}`,
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(safe.argumentsJson).toBeNull();
    expect(safe.resultText).toBeNull();
    expect(safe.contentState).toBe('omitted');
    expect(safe.toolCallId).toBe('call-1');
    expect(JSON.stringify(safe)).not.toContain('syntheticvalue');
  });

  it('redacts complete private key blocks with extra header words', () => {
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
      argumentsValue: null,
      result: 'before\n-----BEGIN PGP PRIVATE KEY BLOCK-----\nsyntheticvalue27\n-----END PGP PRIVATE KEY BLOCK-----\nafter',
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(safe.resultText).toBe('before\n[REDACTED]\nafter');
    expect(safe.contentState).toBe('redacted');
  });

  it('keeps redaction and truncation visible together', () => {
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
      argumentsValue: { token: 'synthetic-value-28' },
      result: 'x'.repeat(40 * 1024),
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(safe.contentState).toBe('redacted-truncated');
    expect(Buffer.byteLength(safe.resultText ?? '', 'utf8')).toBe(32 * 1024);
  });

  it('redacts secrets and bounds the length of error types', () => {
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
      errorType: `GITHUB_TOKEN=synthetic-value-29 ${'E'.repeat(400)}`,
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(safe.errorType).toContain('GITHUB_TOKEN=[REDACTED]');
    expect(safe.errorType).not.toContain('synthetic-value-29');
    expect(Buffer.byteLength(safe.errorType ?? '', 'utf8')).toBeLessThanOrEqual(256);
  });

  it('sanitizes content without attributing the span to a conversation', () => {
    const unattributed = sanitizeUnattributedAgentTraceSpan(makeDecodedAgentTraceSpan({
      source: null,
      sourceResolution: 'missing',
      conversationId: null,
      sessionId: null,
      traceRootInRequest: false,
      argumentsValue: { command: 'echo ok', password: 'synthetic-value-30' },
    }));

    expect(unattributed).not.toHaveProperty('source');
    expect(unattributed).not.toHaveProperty('sessionId');
    expect(unattributed.argumentsJson).toBe('{"command":"echo ok","password":"[REDACTED]"}');

    expect(attributeAgentTraceSpan(unattributed, {
      source: 'copilot-cli',
      sessionId: 'cli-session-1',
    })).toMatchObject({
      source: 'copilot-cli',
      sessionId: 'cli-session-1',
      argumentsJson: '{"command":"echo ok","password":"[REDACTED]"}',
      contentState: 'redacted',
    });
  });

  it('keeps ordinary shell output unchanged', () => {
    const output = 'total 3\n-rw-r--r-- 1 user user 42 README.md\nauthor: Jane Doe\ntokenizer ready';
    const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
      argumentsValue: null,
      result: output,
    }));

    if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');

    expect(safe.resultText).toBe(output);
    expect(safe.contentState).toBe('stored');
  });
});
