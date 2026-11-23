//! The Rust port of `reference/src/agent-trace-correlator.ts`.
//!
//! The correlator is typed. Its JSON entry points exist for the JS bridge only:
//! `to_agent_trace_correlation_facts` takes any JSON value, because the recorded inputs include
//! `null`, strings, arrays and objects without span fields. TypeScript reads those as `undefined`
//! or throws, and a typed span cannot hold that.

#![forbid(unsafe_code)]

use std::collections::HashSet;

use agent_trace_protocol::port::{
    AgentTraceSource as ProtocolSource, DecodedAgentTraceSpan,
    SourceResolution as ProtocolResolution,
};
use agent_trace_sanitizer::js_value::{self, get, object};
use agent_trace_sanitizer::port::{
    AgentTraceAttribution, UnattributedAgentTraceSpan, attribute_agent_trace_span,
};
use indexmap::IndexMap;
use serde::Serialize;
use serde_json::Value;
use shared::{AgentTraceSource, AgentTraceSpan};

pub const PENDING_TRACE_TTL_MS: u64 = 30_000;
pub const MAX_PENDING_SPANS: usize = 2_000;
pub const MAX_PENDING_BYTES: usize = 16 * 1024 * 1024;
const MAX_KNOWN_TRACES: usize = 1_000;
const PENDING_SPAN_OVERHEAD_BYTES: usize = 1_024;

/// Correlation facts copied from a decoded span. Raw tool payloads are never part of them.
#[derive(Debug, Clone, PartialEq)]
pub struct AgentTraceCorrelationFacts {
    pub trace_id: String,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub trace_root_in_request: bool,
    pub trace_source: Option<ProtocolSource>,
    pub trace_source_resolution: ProtocolResolution,
    pub trace_session_id: Option<String>,
    pub span_source: Option<ProtocolSource>,
    pub span_source_resolution: ProtocolResolution,
    pub span_conversation_id: Option<String>,
    pub span_parent_conversation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentTraceCorrelationInput {
    pub facts: AgentTraceCorrelationFacts,
    pub span: UnattributedAgentTraceSpan,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTraceRejectionCounts {
    pub unsupported_source: usize,
    pub missing_source_session: usize,
    pub unresolved_trace_root: usize,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct AgentTraceCorrelationResult {
    /// Spans attributed to a conversation, ready to be stored.
    pub ready: Vec<AgentTraceSpan>,
    /// Spans of the current export rejected immediately; reported in the OTLP response.
    pub rejected: AgentTraceRejectionCounts,
    /// Spans held earlier (or evicted) that could not be attributed and were discarded.
    pub dropped: AgentTraceRejectionCounts,
    /// Spans of the current export still held while their trace root is awaited.
    pub held: usize,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct AgentTraceCorrelatorOptions {
    pub pending_ttl_ms: Option<f64>,
    pub max_pending_spans: Option<usize>,
    pub max_pending_bytes: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RejectionReason {
    UnsupportedSource,
    MissingSourceSession,
    UnresolvedTraceRoot,
}

impl AgentTraceRejectionCounts {
    fn slot(&mut self, reason: RejectionReason) -> &mut usize {
        match reason {
            RejectionReason::UnsupportedSource => &mut self.unsupported_source,
            RejectionReason::MissingSourceSession => &mut self.missing_source_session,
            RejectionReason::UnresolvedTraceRoot => &mut self.unresolved_trace_root,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
enum TraceResolution {
    Attributed(AgentTraceAttribution),
    Rejected(RejectionReason),
}

#[derive(Debug, Clone)]
struct PendingSpan {
    input: AgentTraceCorrelationInput,
    bytes: usize,
}

#[derive(Debug, Clone)]
struct PendingTrace {
    first_received_at_ms: f64,
    spans: IndexMap<String, PendingSpan>,
}

/// Attributes spans to a conversation across export requests. Sanitized spans without a known
/// trace root are held for a bounded time and size; when a bound is reached they fall back to the
/// conversation context of their own attested ancestry, or are dropped and counted.
pub struct AgentTraceCorrelator {
    ttl_ms: f64,
    max_spans: usize,
    max_bytes: usize,
    pending: IndexMap<String, PendingTrace>,
    known: IndexMap<String, TraceResolution>,
    pending_spans: usize,
    pending_bytes: usize,
}

pub fn create_agent_trace_correlator(options: AgentTraceCorrelatorOptions) -> AgentTraceCorrelator {
    AgentTraceCorrelator {
        ttl_ms: options
            .pending_ttl_ms
            .unwrap_or(PENDING_TRACE_TTL_MS as f64),
        max_spans: options.max_pending_spans.unwrap_or(MAX_PENDING_SPANS),
        max_bytes: options.max_pending_bytes.unwrap_or(MAX_PENDING_BYTES),
        pending: IndexMap::new(),
        known: IndexMap::new(),
        pending_spans: 0,
        pending_bytes: 0,
    }
}

impl AgentTraceCorrelator {
    pub fn ingest(
        &mut self,
        inputs: &[AgentTraceCorrelationInput],
        now_ms: f64,
    ) -> Result<AgentTraceCorrelationResult, String> {
        let mut result = AgentTraceCorrelationResult::default();

        for (trace_id, group) in group_by_trace(inputs) {
            let root = resolve_from_trace_root(&group);
            if let Some(resolution) = &root {
                self.remember_trace(trace_id, resolution.clone());
            }

            let resolution = root.or_else(|| self.known.get(trace_id).cloned());
            if let Some(resolution) = resolution {
                apply_resolution(&group, &resolution, &mut result.ready, &mut result.rejected)?;
                if let Some(held) = self.take_pending(trace_id) {
                    let held_inputs: Vec<&AgentTraceCorrelationInput> =
                        held.spans.values().map(|span| &span.input).collect();
                    apply_resolution(
                        &held_inputs,
                        &resolution,
                        &mut result.ready,
                        &mut result.dropped,
                    )?;
                }
                continue;
            }

            if !self.pending.contains_key(trace_id)
                && !group.iter().any(|input| {
                    input.facts.span_source_resolution == ProtocolResolution::Supported
                })
            {
                for input in &group {
                    let reason = rejection_reason_for(input.facts.span_source_resolution);
                    *result.rejected.slot(reason) += 1;
                }
                continue;
            }

            self.hold_spans(trace_id, &group, now_ms);
        }

        self.enforce_limits(&mut result)?;
        result.held = inputs
            .iter()
            .filter(|input| {
                self.pending
                    .get(&input.facts.trace_id)
                    .is_some_and(|trace| trace.spans.contains_key(&input.facts.span_id))
            })
            .count();
        Ok(result)
    }

    pub fn expire(&mut self, now_ms: f64) -> Result<AgentTraceCorrelationResult, String> {
        let mut result = AgentTraceCorrelationResult::default();
        while let Some(first_received_at_ms) = self
            .pending
            .get_index(0)
            .map(|(_, trace)| trace.first_received_at_ms)
        {
            if now_ms - first_received_at_ms < self.ttl_ms {
                break;
            }
            let Some(trace) = self.take_oldest_pending() else {
                break;
            };
            resolve_by_fallback(&trace, &mut result)?;
        }
        Ok(result)
    }

    pub fn flush_all(&mut self) -> Result<AgentTraceCorrelationResult, String> {
        let mut result = AgentTraceCorrelationResult::default();
        while let Some(trace) = self.take_oldest_pending() {
            resolve_by_fallback(&trace, &mut result)?;
        }
        Ok(result)
    }

    pub fn discard_pending(&mut self) {
        self.pending.clear();
        self.known.clear();
        self.pending_spans = 0;
        self.pending_bytes = 0;
    }

    pub fn next_expiry_at(&self) -> Option<f64> {
        self.pending
            .get_index(0)
            .map(|(_, trace)| trace.first_received_at_ms + self.ttl_ms)
    }

    pub fn pending_span_count(&self) -> usize {
        self.pending_spans
    }

    fn hold_spans(&mut self, trace_id: &str, group: &[&AgentTraceCorrelationInput], now_ms: f64) {
        let held = self
            .pending
            .entry(trace_id.to_owned())
            .or_insert_with(|| PendingTrace {
                first_received_at_ms: now_ms,
                spans: IndexMap::new(),
            });

        for input in group {
            let bytes = estimate_span_bytes(&input.span);
            let span = PendingSpan {
                input: (*input).clone(),
                bytes,
            };
            if let Some(previous) = held.spans.insert(input.facts.span_id.clone(), span) {
                self.pending_spans -= 1;
                self.pending_bytes -= previous.bytes;
            }
            self.pending_spans += 1;
            self.pending_bytes += bytes;
        }
    }

    fn enforce_limits(&mut self, result: &mut AgentTraceCorrelationResult) -> Result<(), String> {
        while (self.pending_spans > self.max_spans || self.pending_bytes > self.max_bytes)
            && !self.pending.is_empty()
        {
            let Some(oldest) = self.take_oldest_pending() else {
                break;
            };
            resolve_by_fallback(&oldest, result)?;
        }
        Ok(())
    }

    fn take_pending(&mut self, trace_id: &str) -> Option<PendingTrace> {
        let trace = self.pending.shift_remove(trace_id)?;
        self.release(&trace);
        Some(trace)
    }

    fn take_oldest_pending(&mut self) -> Option<PendingTrace> {
        let (_, trace) = self.pending.shift_remove_index(0)?;
        self.release(&trace);
        Some(trace)
    }

    fn release(&mut self, trace: &PendingTrace) {
        self.pending_spans -= trace.spans.len();
        self.pending_bytes -= trace.spans.values().map(|span| span.bytes).sum::<usize>();
    }

    fn remember_trace(&mut self, trace_id: &str, resolution: TraceResolution) {
        self.known.shift_remove(trace_id);
        self.known.insert(trace_id.to_owned(), resolution);
        if self.known.len() > MAX_KNOWN_TRACES {
            self.known.shift_remove_index(0);
        }
    }
}

/// Port of `toAgentTraceCorrelationFacts`: copies the correlation fields of a decoded span.
pub fn decoded_to_correlation_facts(decoded: &DecodedAgentTraceSpan) -> AgentTraceCorrelationFacts {
    AgentTraceCorrelationFacts {
        trace_id: decoded.trace_id.clone(),
        span_id: decoded.span_id.clone(),
        parent_span_id: decoded.parent_span_id.clone(),
        trace_root_in_request: decoded.trace_root_in_request,
        trace_source: decoded.source,
        trace_source_resolution: decoded.source_resolution,
        trace_session_id: decoded.session_id.clone(),
        span_source: decoded.span_source,
        span_source_resolution: decoded.span_source_resolution,
        span_conversation_id: decoded.span_conversation_id.clone(),
        span_parent_conversation_id: decoded.span_parent_conversation_id.clone(),
    }
}

/// `toAgentTraceCorrelationFacts` over JSON from the JS bridge. Missing fields are `undefined`,
/// and `null` throws the TypeError of the TypeScript property read.
pub fn to_agent_trace_correlation_facts(decoded: Value) -> Result<Value, String> {
    let decoded = js_value::from_value(&decoded)?;
    let out = object(vec![
        ("traceId".into(), get(&decoded, "traceId")?),
        ("spanId".into(), get(&decoded, "spanId")?),
        ("parentSpanId".into(), get(&decoded, "parentSpanId")?),
        (
            "traceRootInRequest".into(),
            get(&decoded, "traceRootInRequest")?,
        ),
        ("traceSource".into(), get(&decoded, "source")?),
        (
            "traceSourceResolution".into(),
            get(&decoded, "sourceResolution")?,
        ),
        ("traceSessionId".into(), get(&decoded, "sessionId")?),
        ("spanSource".into(), get(&decoded, "spanSource")?),
        (
            "spanSourceResolution".into(),
            get(&decoded, "spanSourceResolution")?,
        ),
        (
            "spanConversationId".into(),
            get(&decoded, "spanConversationId")?,
        ),
        (
            "spanParentConversationId".into(),
            get(&decoded, "spanParentConversationId")?,
        ),
    ]);
    Ok(js_value::to_value(&out))
}

/// `emptyCounts` as JSON for the JS bridge.
pub fn empty_counts() -> Result<Value, String> {
    serde_json::to_value(AgentTraceRejectionCounts::default()).map_err(|error| error.to_string())
}

fn resolve_from_trace_root(group: &[&AgentTraceCorrelationInput]) -> Option<TraceResolution> {
    let anchor = group
        .iter()
        .find(|input| input.facts.trace_root_in_request)?;
    let facts = &anchor.facts;
    match (facts.trace_source, facts.trace_session_id.as_ref()) {
        (Some(source), Some(session_id)) => {
            Some(TraceResolution::Attributed(AgentTraceAttribution {
                source: shared_source(source),
                session_id: session_id.clone(),
            }))
        }
        _ => Some(TraceResolution::Rejected(
            if facts.trace_source_resolution == ProtocolResolution::Unsupported {
                RejectionReason::UnsupportedSource
            } else {
                RejectionReason::MissingSourceSession
            },
        )),
    }
}

fn apply_resolution(
    inputs: &[&AgentTraceCorrelationInput],
    resolution: &TraceResolution,
    ready: &mut Vec<AgentTraceSpan>,
    counts: &mut AgentTraceRejectionCounts,
) -> Result<(), String> {
    match resolution {
        TraceResolution::Rejected(reason) => *counts.slot(*reason) += inputs.len(),
        TraceResolution::Attributed(attribution) => {
            for input in inputs {
                ready.push(attribute_agent_trace_span(&input.span, attribution)?);
            }
        }
    }
    Ok(())
}

fn resolve_by_fallback(
    trace: &PendingTrace,
    result: &mut AgentTraceCorrelationResult,
) -> Result<(), String> {
    for span in trace.spans.values() {
        match find_ancestor_attribution(span, &trace.spans) {
            Some(attribution) => {
                result
                    .ready
                    .push(attribute_agent_trace_span(&span.input.span, &attribution)?);
            }
            None => {
                let reason =
                    if span.input.facts.span_source_resolution == ProtocolResolution::Unsupported {
                        RejectionReason::UnsupportedSource
                    } else {
                        RejectionReason::UnresolvedTraceRoot
                    };
                *result.dropped.slot(reason) += 1;
            }
        }
    }
    Ok(())
}

/// Walks the attested parent chain inside the held trace and keeps the top-most explicit context.
fn find_ancestor_attribution(
    held_span: &PendingSpan,
    held_spans: &IndexMap<String, PendingSpan>,
) -> Option<AgentTraceAttribution> {
    let mut visited = HashSet::new();
    let mut attribution = None;
    let mut current = Some(held_span);

    while let Some(span) = current {
        if !visited.insert(span.input.facts.span_id.as_str()) {
            break;
        }
        if let Some(explicit) = explicit_attribution(&span.input.facts) {
            attribution = Some(explicit);
        }
        current = span
            .input
            .facts
            .parent_span_id
            .as_deref()
            .and_then(|parent| held_spans.get(parent));
    }

    attribution
}

fn explicit_attribution(facts: &AgentTraceCorrelationFacts) -> Option<AgentTraceAttribution> {
    let source = facts.span_source?;
    let conversation_id = facts
        .span_parent_conversation_id
        .clone()
        .or_else(|| facts.span_conversation_id.clone())?;
    let session_id = match source {
        ProtocolSource::Vscode => format!("vscode:{conversation_id}"),
        ProtocolSource::CopilotCli => conversation_id,
    };
    Some(AgentTraceAttribution {
        source: shared_source(source),
        session_id,
    })
}

fn shared_source(source: ProtocolSource) -> AgentTraceSource {
    match source {
        ProtocolSource::Vscode => AgentTraceSource::Vscode,
        ProtocolSource::CopilotCli => AgentTraceSource::CopilotCli,
    }
}

fn rejection_reason_for(resolution: ProtocolResolution) -> RejectionReason {
    if resolution == ProtocolResolution::Unsupported {
        RejectionReason::UnsupportedSource
    } else {
        RejectionReason::MissingSourceSession
    }
}

fn group_by_trace(
    inputs: &[AgentTraceCorrelationInput],
) -> IndexMap<&str, Vec<&AgentTraceCorrelationInput>> {
    let mut groups: IndexMap<&str, Vec<&AgentTraceCorrelationInput>> = IndexMap::new();
    for input in inputs {
        groups
            .entry(input.facts.trace_id.as_str())
            .or_default()
            .push(input);
    }
    groups
}

/// `estimateSpanBytes`: JS string lengths count UTF-16 code units, so the estimate does too.
fn estimate_span_bytes(span: &UnattributedAgentTraceSpan) -> usize {
    let units = |text: &Option<String>| text.as_deref().map_or(0, |t| t.encode_utf16().count());
    (units(&span.arguments_json) + units(&span.result_text)) * 2 + PENDING_SPAN_OVERHEAD_BYTES
}
