import path from 'node:path';
import protobuf from 'protobufjs';
import { describe, expect, it } from 'vitest';

const traceId = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const rootSpanId = Buffer.from('1111222233334444', 'hex');
const chatSpanId = Buffer.from('2222333344445555', 'hex');
const toolSpanId = Buffer.from('5555666677778888', 'hex');
const inheritedContextSpanId = Buffer.from('6666777788889999', 'hex');
const skillSpanId = Buffer.from('777788889999aaaa', 'hex');
const start = '1780000000000000000';
const end = '1780000000100000000';

const OTLP_FIXTURE = {
  resourceSpans: [{
    resource: {
      attributes: [{ key: 'service.name', value: { stringValue: 'copilot-chat' } }],
    },
    scopeSpans: [{
      spans: [
        {
          traceId,
          spanId: rootSpanId,
          name: 'invoke_agent copilot',
          startTimeUnixNano: start,
          endTimeUnixNano: end,
          attributes: [
            { key: 'gen_ai.agent.name', value: { stringValue: 'copilot' } },
            { key: 'gen_ai.conversation.id', value: { stringValue: 'conversation-1' } },
            { key: 'gen_ai.input.messages', value: { stringValue: 'synthetic prompt' } },
          ],
          status: { code: 1 },
        },
        {
          traceId,
          spanId: chatSpanId,
          parentSpanId: rootSpanId,
          name: 'chat gpt-5.4',
          startTimeUnixNano: start,
          endTimeUnixNano: end,
          attributes: [{ key: 'gen_ai.request.model', value: { stringValue: 'gpt-5.4' } }],
        },
        {
          traceId,
          spanId: toolSpanId,
          parentSpanId: chatSpanId,
          name: 'execute_tool runCommand',
          startTimeUnixNano: start,
          endTimeUnixNano: end,
          attributes: [
            { key: 'gen_ai.tool.name', value: { stringValue: 'runCommand' } },
            { key: 'gen_ai.tool.call.id', value: { stringValue: 'call-1' } },
            { key: 'gen_ai.tool.call.arguments', value: { stringValue: '{"command":"echo trace-probe"}' } },
            { key: 'gen_ai.tool.call.result', value: { stringValue: 'trace-probe' } },
          ],
          status: { code: 1 },
        },
        {
          traceId,
          spanId: inheritedContextSpanId,
          name: 'execute_tool inheritedContext',
          startTimeUnixNano: start,
          endTimeUnixNano: end,
          attributes: [
            { key: 'gen_ai.tool.name', value: { stringValue: 'inheritedContext' } },
          ],
          status: { code: 1 },
        },
        {
          traceId,
          spanId: skillSpanId,
          parentSpanId: rootSpanId,
          name: 'execute_tool loadSkill',
          startTimeUnixNano: start,
          endTimeUnixNano: end,
          attributes: [
            { key: 'gen_ai.tool.name', value: { stringValue: 'loadSkill' } },
            { key: 'gen_ai.tool.call.id', value: { stringValue: 'call-skill' } },
            { key: 'github.copilot.tool.parameters.skill_name', value: { stringValue: 'trace-probe' } },
          ],
          status: { code: 1 },
        },
      ],
    }],
  }],
};

function encodeFixture(fixture: object): Uint8Array {
  const protoRoot = path.resolve(process.cwd(), 'src', 'main', 'agent-trace-proto');
  const root = new protobuf.Root();
  root.resolvePath = (_origin, target) => path.resolve(protoRoot, target);
  root.loadSync(path.join(
    protoRoot,
    'opentelemetry',
    'proto',
    'collector',
    'trace',
    'v1',
    'trace_service.proto',
  ));
  const requestType = root.lookupType(
    'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest',
  );

  return requestType.encode(requestType.fromObject(fixture)).finish();
}

async function decodePayload(payload: Uint8Array) {
  const protocolModule = await import('./agent-trace-protocol');
  return protocolModule.decodeOtlpTraceRequest(payload);
}

describe('decodeOtlpTraceRequest', () => {
  it('extracts IDs, attributes, categories, status, and hierarchy without copying input messages', async () => {
    const decoded = await decodePayload(encodeFixture(OTLP_FIXTURE));

    expect(decoded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          traceId: '00112233445566778899aabbccddeeff',
          spanId: '1111222233334444',
          parentSpanId: null,
          name: 'invoke_agent copilot',
          source: 'vscode',
          sourceResolution: 'supported',
          conversationId: 'conversation-1',
          sessionId: 'vscode:conversation-1',
          category: 'agent',
          startedAtNs: start,
          endedAtNs: end,
          status: 'ok',
        }),
        expect.objectContaining({
          spanId: '2222333344445555',
          parentSpanId: '1111222233334444',
          name: 'chat gpt-5.4',
          category: 'llm',
          model: 'gpt-5.4',
        }),
        expect.objectContaining({
          spanId: '5555666677778888',
          parentSpanId: '2222333344445555',
          name: 'execute_tool runCommand',
          source: 'vscode',
          sourceResolution: 'supported',
          conversationId: 'conversation-1',
          sessionId: 'vscode:conversation-1',
          category: 'tool',
          toolName: 'runCommand',
          toolCallId: 'call-1',
          argumentsValue: '{"command":"echo trace-probe"}',
          result: 'trace-probe',
          status: 'ok',
        }),
        expect.objectContaining({
          spanId: '777788889999aaaa',
          parentSpanId: '1111222233334444',
          category: 'skill',
          skillName: 'trace-probe',
          toolCallId: 'call-skill',
        }),
      ]),
    );
    expect(JSON.stringify(decoded)).not.toContain('synthetic prompt');
  });

  it('inherits source and session from the recognized trace root without fabricating a parent span', async () => {
    const fixture = structuredClone(OTLP_FIXTURE);
    fixture.resourceSpans[0].scopeSpans[0].spans = [
      fixture.resourceSpans[0].scopeSpans[0].spans[3],
      fixture.resourceSpans[0].scopeSpans[0].spans[0],
      fixture.resourceSpans[0].scopeSpans[0].spans[1],
      fixture.resourceSpans[0].scopeSpans[0].spans[2],
    ];

    const decoded = await decodePayload(encodeFixture(fixture));

    expect(decoded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          spanId: '6666777788889999',
          source: 'vscode',
          sourceResolution: 'supported',
          conversationId: 'conversation-1',
          sessionId: 'vscode:conversation-1',
          parentSpanId: null,
          toolName: 'inheritedContext',
        }),
      ]),
    );
  });

  it('preserves nanosecond timestamps beyond Number.MAX_SAFE_INTEGER', async () => {
    const fixture = structuredClone(OTLP_FIXTURE);
    fixture.resourceSpans[0].scopeSpans[0].spans[0].startTimeUnixNano = '9007199254740993123';
    fixture.resourceSpans[0].scopeSpans[0].spans[0].endTimeUnixNano = '9007199254740993999';

    const [decodedRoot] = await decodePayload(encodeFixture(fixture));

    expect(decodedRoot).toMatchObject({
      spanId: '1111222233334444',
      startedAtNs: '9007199254740993123',
      endedAtNs: '9007199254740993999',
    });
  });

  it('propagates the root source and conversation across ResourceSpans in the same trace', async () => {
    const fixture = structuredClone(OTLP_FIXTURE);
    fixture.resourceSpans = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'github-copilot' } }],
        },
        scopeSpans: [{
          spans: [{
            traceId,
            spanId: rootSpanId,
            name: 'invoke_agent cli',
            startTimeUnixNano: start,
            endTimeUnixNano: end,
            attributes: [
              { key: 'gen_ai.conversation.id', value: { stringValue: 'cli-session-7' } },
            ],
          }],
        }],
      },
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'copilot-chat' } }],
        },
        scopeSpans: [{
          spans: [{
            traceId,
            spanId: toolSpanId,
            parentSpanId: rootSpanId,
            name: 'execute_tool runCommand',
            startTimeUnixNano: start,
            endTimeUnixNano: end,
            attributes: [
              { key: 'gen_ai.tool.name', value: { stringValue: 'runCommand' } },
            ],
          }],
        }],
      },
    ];

    const decoded = await decodePayload(encodeFixture(fixture));

    expect(decoded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          spanId: '1111222233334444',
          source: 'copilot-cli',
          sourceResolution: 'supported',
          conversationId: 'cli-session-7',
          sessionId: 'cli-session-7',
        }),
        expect.objectContaining({
          spanId: '5555666677778888',
          source: 'copilot-cli',
          sourceResolution: 'supported',
          conversationId: 'cli-session-7',
          sessionId: 'cli-session-7',
        }),
      ]),
    );
  });

  it('marks traces from unsupported service names without preserving the raw service name', async () => {
    const fixture = structuredClone(OTLP_FIXTURE);
    fixture.resourceSpans = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'unsupported-client' } }],
        },
        scopeSpans: [{
          spans: [{
            traceId,
            spanId: rootSpanId,
            name: 'invoke_agent copilot',
            startTimeUnixNano: start,
            endTimeUnixNano: end,
            attributes: [
              { key: 'gen_ai.conversation.id', value: { stringValue: 'conversation-1' } },
            ],
          }],
        }],
      },
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'copilot-chat' } }],
        },
        scopeSpans: [{
          spans: [{
            traceId,
            spanId: toolSpanId,
            parentSpanId: rootSpanId,
            name: 'execute_tool runCommand',
            startTimeUnixNano: start,
            endTimeUnixNano: end,
            attributes: [
              { key: 'gen_ai.tool.name', value: { stringValue: 'runCommand' } },
            ],
          }],
        }],
      },
    ];

    const decoded = await decodePayload(encodeFixture(fixture));
    const decodedRoot = decoded.find((span) => span.spanId === '1111222233334444');
    const decodedChild = decoded.find((span) => span.spanId === '5555666677778888');

    expect(decodedRoot).toMatchObject({
      spanId: '1111222233334444',
      source: null,
      sourceResolution: 'unsupported',
      conversationId: 'conversation-1',
      sessionId: null,
    });
    expect(decodedChild).toMatchObject({
      spanId: '5555666677778888',
      source: null,
      sourceResolution: 'unsupported',
      conversationId: 'conversation-1',
      sessionId: null,
    });
    expect(JSON.stringify(decoded)).not.toContain('unsupported-client');
  });

  it('marks traces with no root service name as missing source metadata', async () => {
    const fixture = structuredClone(OTLP_FIXTURE);
    fixture.resourceSpans[0].resource.attributes = [];

    const [decodedRoot] = await decodePayload(encodeFixture(fixture));

    expect(decodedRoot).toMatchObject({
      spanId: '1111222233334444',
      source: null,
      sourceResolution: 'missing',
      conversationId: 'conversation-1',
      sessionId: null,
    });
  });

  it('classifies hook, skill, and shell spans from their names and tool parameters', async () => {
    const fixture = structuredClone(OTLP_FIXTURE);
    fixture.resourceSpans[0].scopeSpans[0].spans = [
      {
        traceId,
        spanId: rootSpanId,
        name: 'invoke_agent copilot',
        startTimeUnixNano: start,
        endTimeUnixNano: end,
        attributes: [
          { key: 'gen_ai.conversation.id', value: { stringValue: 'conversation-1' } },
        ],
      },
      {
        traceId,
        spanId: chatSpanId,
        parentSpanId: rootSpanId,
        name: 'execute_hook pre_response',
        startTimeUnixNano: start,
        endTimeUnixNano: end,
      },
      {
        traceId,
        spanId: Buffer.from('88889999aaaabbbb', 'hex'),
        parentSpanId: rootSpanId,
        name: 'execute_tool useSkill',
        startTimeUnixNano: start,
        endTimeUnixNano: end,
        attributes: [
          { key: 'github.copilot.tool.parameters.skill_name', value: { stringValue: 'specify' } },
          { key: 'gen_ai.tool.name', value: { stringValue: 'useSkill' } },
        ],
      },
      {
        traceId,
        spanId: Buffer.from('9999aaaabbbbcccc', 'hex'),
        parentSpanId: rootSpanId,
        name: 'execute_tool runShell',
        startTimeUnixNano: start,
        endTimeUnixNano: end,
        attributes: [
          { key: 'github.copilot.tool.parameters.command', value: { stringValue: 'echo ok' } },
          { key: 'gen_ai.tool.name', value: { stringValue: 'runShell' } },
        ],
      },
    ];

    const decoded = await decodePayload(encodeFixture(fixture));

    expect(decoded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'execute_hook pre_response', category: 'hook' }),
        expect.objectContaining({ name: 'execute_tool useSkill', category: 'skill', skillName: 'specify' }),
        expect.objectContaining({ name: 'execute_tool runShell', category: 'shell' }),
      ]),
    );
  });

  it('materializes only allowlisted attributes from resource and span payloads', async () => {
    const fixture = structuredClone(OTLP_FIXTURE);
    fixture.resourceSpans[0].resource.attributes.push({
      key: 'service.version',
      value: { stringValue: '1.2.3' },
    });
    fixture.resourceSpans[0].scopeSpans[0].spans[2].attributes.push(
      { key: 'gen_ai.error.type', value: { stringValue: 'tool_failure' } },
      { key: 'gen_ai.output.messages', value: { stringValue: 'synthetic response' } },
      {
        key: 'unknown.map',
        value: {
          kvlistValue: {
            values: [{ key: 'prompt', value: { stringValue: 'secret prompt' } }],
          },
        },
      },
    );

    const decoded = await decodePayload(encodeFixture(fixture));
    const toolSpan = decoded.find((span) => span.spanId === '5555666677778888');

    expect(toolSpan).toMatchObject({
      errorType: 'tool_failure',
      argumentsValue: '{"command":"echo trace-probe"}',
      result: 'trace-probe',
    });
    expect(JSON.stringify(decoded)).not.toContain('synthetic response');
    expect(JSON.stringify(decoded)).not.toContain('secret prompt');
    expect(JSON.stringify(decoded)).not.toContain('1.2.3');
  });

  it('throws for an invalid protobuf body', async () => {
    await expect(decodePayload(Uint8Array.from([0xff, 0x01, 0x02]))).rejects.toThrow(
      /OTLP trace request/i,
    );
  });

  it('throws for invalid trace or span ID lengths', async () => {
    const fixture = structuredClone(OTLP_FIXTURE);
    fixture.resourceSpans[0].scopeSpans[0].spans[0].traceId = Buffer.from('00112233', 'hex');
    fixture.resourceSpans[0].scopeSpans[0].spans[1].spanId = Buffer.from('22223333', 'hex');

    await expect(decodePayload(encodeFixture(fixture))).rejects.toThrow(/invalid (trace|span) id/i);
  });
});
