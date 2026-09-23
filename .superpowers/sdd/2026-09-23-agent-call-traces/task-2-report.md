# Task 2 Report — OTel/Protobuf decoder

## Status
DONE

Implementation, focused protocol tests, and the synthetic-client feasibility gate are complete.

## Commit
- SHA: `8d823f3c43acf8b01d4eabf6bda757cf787d2623`
- Subject: `feat: decode Copilot OpenTelemetry spans`

## Scope completed
Implemented Task 2 only:
- pinned OpenTelemetry trace/resource/common/collector `.proto` sources under `src/main/agent-trace-proto/`
- reproducible `generate:agent-trace-proto` script in `package.json`
- checked-in generated static protobuf module and declarations
- pure OTLP trace decoder in `src/main/agent-trace-protocol.ts`
- focused protocol tests in `src/main/agent-trace-protocol.test.ts`
- synthetic fixture factories in `src/test-utils/agent-trace-fixtures.ts`

Did **not** start sanitization, persistence, HTTP receiver work, or UI work.

## TDD evidence
### Red
Command:
```powershell
rtk npm test -- src/main/agent-trace-protocol.test.ts
```
Observed failure before implementation:
- Vite failed to resolve `./agent-trace-protocol`
- no tests executed because the decoder module/function did not exist yet

### Green
Command:
```powershell
rtk npm test -- src/main/agent-trace-protocol.test.ts
```
Observed result:
- `Test Files  1 passed (1)`
- `Tests  7 passed (7)`

## Behavior covered by focused tests
- valid OTLP protobuf decode for root/chat/tool spans
- source/session derivation from `service.name` + root `gen_ai.conversation.id`
- VS Code `vscode:` session prefix and raw Copilot CLI session ID preservation
- parent/child hierarchy extraction
- category mapping for `agent`, `llm`, `tool`, `hook`, `skill`, `shell`
- `gen_ai.input.messages` excluded from decoded output
- exact nanosecond preservation beyond `Number.MAX_SAFE_INTEGER`
- multi-`ResourceSpans` trace grouping with root-source propagation
- unsupported source producing partial (`source: null`, `sessionId: null`) output
- invalid protobuf and invalid trace/span ID rejection

## Live feasibility result
Controller-verified synthetic runs confirmed the required OTLP fields were observable without persisting raw payloads or user conversations. The VS Code path produced six linked `execute_tool` spans with conversation and parent linkage, plus two intentionally unlinked `execute_tool` spans that the task treats as explicit partial/rejected cases. The Copilot CLI path produced a real synthetic interactive tool call with the expected tool metadata and span linkage. The local capture only recorded span/attribute names and field presence, and the temporary capture files and CLI homes were removed afterward.

## Implementation notes
- imported `AgentTraceSource` and `AgentTraceCategory` from `src/shared/types.ts`
- did not alter Task 1 SQL/session mapping behavior
- decoder keeps `argumentsValue` / `result` only in memory and does not write or log them
- grouped spans by `traceId` before root-based source/session propagation
- validated trace/span byte lengths and rejected invalid IDs
- preserved nanosecond values as strings in the decoder output

## Ambiguity resolved
The brief’s sample expectation showed the tool span with the root parent span ID, while the fixture defines the tool span as a child of the chat span. I implemented and tested the actual OTLP hierarchy from the fixture (`tool -> chat -> root`) because that is consistent with the stated hierarchy requirement.

## Workspace hygiene
- left unrelated dirty files in `.claude\*` and `.github\copilot-instructions.md` untouched
- staged/committed only the Task 2 files from the brief

## Fix round 1

### Status
DONE

### Review findings addressed
1. **Pinned schema mismatch**
   - Replaced `src/main/agent-trace-proto/opentelemetry/proto/trace/v1/trace.proto` with the exact upstream blob content for SHA `235b54e8e78b55f0bb4f3f1f43fc89bdda28b04c`, preserving the Apache 2.0 header.
   - Regenerated the checked-in static protobuf artifacts with:
     ```powershell
     rtk npm run generate:agent-trace-proto
     ```
   - Verified the raw blob hash locally with:
     ```powershell
     rtk proxy git hash-object --no-filters -- src\main\agent-trace-proto\opentelemetry\proto\trace\v1\trace.proto
     ```
     Result: `235b54e8e78b55f0bb4f3f1f43fc89bdda28b04c`

2. **Same-trace context versus parent links**
   - Added a regression test where an `execute_tool` span with the shared `traceId` appears before the actual `invoke_agent` root and has no `parentSpanId`.
   - Updated root selection so trace metadata comes from the recognized conversation root (`agent` + `gen_ai.conversation.id` + supported source), not from the first unparented span.
   - Preserved the source-supplied `parentSpanId` exactly; the unlinked span now inherits `source`, `conversationId`, and `sessionId` while remaining `parentSpanId: null`.

3. **Raw attribute materialization**
   - Replaced generic collection of every resource/span attribute with allowlisted extraction only.
   - Resource decoding now materializes only `service.name`.
   - Span decoding now materializes only the keys listed in the Task 2 brief, including `gen_ai.error.type`.
   - Added a regression test with `gen_ai.input.messages`, `gen_ai.output.messages`, an unknown kvlist attribute, and a non-allowlisted resource attribute to prove they are absent from decoded output.
   - Only allowlisted tool argument/result values are copied into `DecodedAgentTraceSpan`.

### TDD evidence for fix round
#### Red
Command:
```powershell
rtk npm test -- src/main/agent-trace-protocol.test.ts
```
Observed failure before the fix:
- inherited same-trace span lost `conversationId`/`sessionId` because root selection chose the wrong unparented span
- `gen_ai.error.type` was not mapped into `errorType`

#### Green
Command:
```powershell
rtk npm test -- src/main/agent-trace-protocol.test.ts
```
Observed result:
- `Test Files  1 passed (1)`
- `Tests  9 passed (9)`

### Full validation
Command:
```powershell
rtk npm test
```
Observed result:
- `Test Files  56 passed (56)`
- `Tests  358 passed (358)`

### Files changed in fix round
- `src/main/agent-trace-protocol.ts`
- `src/main/agent-trace-protocol.test.ts`

### Notes
- `trace.proto` was rewritten from the exact pinned blob and verified with `git hash-object --no-filters`; after normalization it produced no checked-in content delta.
- Regenerating `src/main/agent-trace-proto.generated.js` and `.d.ts` after the schema correction produced no checked-in content delta.
- No live sessions were rerun.
- No raw prompt, response, or payload values were added to logs or this report beyond the pre-existing synthetic fixture literals already required by the task brief/tests.
