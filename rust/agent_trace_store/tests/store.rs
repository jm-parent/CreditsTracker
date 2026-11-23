mod common;

use std::path::Path;

use agent_trace_store::port::open_agent_trace_store;
use rusqlite::Connection;
use shared::{
    AgentTraceCategory, AgentTraceContentState, AgentTraceSelection, AgentTraceSource,
    AgentTraceSpan, AgentTraceSpanStatus,
};

fn span(span_id: &str, parent: Option<&str>) -> AgentTraceSpan {
    AgentTraceSpan {
        source: AgentTraceSource::CopilotCli,
        session_id: "sess-1".into(),
        trace_id: "t1".into(),
        span_id: span_id.into(),
        parent_span_id: parent.map(str::to_owned),
        name: "execute_tool".into(),
        category: AgentTraceCategory::Tool,
        tool_name: Some("grep".into()),
        skill_name: None,
        model: None,
        started_at: "2026-11-23T10:00:00.000Z".into(),
        ended_at: "2026-11-23T10:00:01.000Z".into(),
        duration_ms: 1000.0,
        status: AgentTraceSpanStatus::Ok,
        error_type: None,
        tool_call_id: None,
        arguments_json: Some("{}".into()),
        result_text: Some("ok".into()),
        content_state: AgentTraceContentState::Stored,
    }
}

fn selection() -> AgentTraceSelection {
    AgentTraceSelection {
        source: AgentTraceSource::CopilotCli,
        session_id: "sess-1".into(),
    }
}

fn row_count(db: &Path) -> i64 {
    Connection::open(db)
        .expect("open database")
        .query_row("SELECT COUNT(*) FROM agent_trace_spans", [], |row| {
            row.get(0)
        })
        .expect("count rows")
}

#[test]
fn reopening_an_existing_store_keeps_its_rows() {
    let db = common::scratch("reopen").join("agent-trace-store.db");
    let mut store = open_agent_trace_store(&db).expect("open");
    store
        .insert_spans(&[span("root", None), span("tool", Some("root"))])
        .expect("insert");
    store.close();

    let mut reopened = open_agent_trace_store(&db).expect("reopen");
    let session = reopened.get_session(&selection()).expect("session");
    assert_eq!(session.spans.len(), 2);
    assert_eq!(row_count(&db), 2);
}

#[test]
fn creates_the_store_file_in_a_missing_parent_folder() {
    let db = common::scratch("missing-parent")
        .join("nested")
        .join("folders")
        .join("agent-trace-store.db");
    open_agent_trace_store(&db).expect("open");
    assert!(db.is_file());
}
