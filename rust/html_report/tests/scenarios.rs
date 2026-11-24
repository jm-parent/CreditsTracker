//! Replays the TypeScript renders in `tests/fixtures/scenarios.json` against the port, byte for byte. The file is
//! written by `reference/scenarios/html-report-scenarios.ts`, which renders synthetic reports with
//! `reference/src/html-report.ts`.

use html_report::port::render_html_report;
use serde_json::Value;
use shared::{ExportReport, HtmlReportOptions};

const FIXTURE: &str = include_str!("fixtures/scenarios.json");
const RECORDED_SCENARIOS: usize = 11;

/// Byte offset of the first difference, with the text around it, for a readable failure.
fn describe_difference(expected: &str, actual: &str) -> String {
    let at = expected
        .bytes()
        .zip(actual.bytes())
        .position(|(e, a)| e != a)
        .unwrap_or_else(|| expected.len().min(actual.len()));
    let window = |s: &str| {
        let start = at.saturating_sub(60);
        let end = (at + 60).min(s.len());
        let start = (start..=at).find(|&i| s.is_char_boundary(i)).unwrap_or(at);
        let end = (end..=s.len())
            .find(|&i| s.is_char_boundary(i))
            .unwrap_or(s.len());
        s[start..end].to_string()
    };
    format!(
        "first difference at byte {at} (expected {} bytes, actual {} bytes)\n  expected: {:?}\n  actual:   {:?}",
        expected.len(),
        actual.len(),
        window(expected),
        window(actual)
    )
}

#[test]
fn renders_match_typescript_byte_for_byte() {
    let scenarios: Vec<Value> = serde_json::from_str(FIXTURE).expect("fixture is JSON");
    assert_eq!(
        scenarios.len(),
        RECORDED_SCENARIOS,
        "the recording holds every scenario"
    );

    for scenario in &scenarios {
        let name = scenario["name"].as_str().expect("scenario name");
        let report: ExportReport =
            serde_json::from_value(scenario["report"].clone()).expect("report");
        let options: HtmlReportOptions =
            serde_json::from_value(scenario["options"].clone()).expect("options");
        let expected = scenario["html"].as_str();
        let result = render_html_report(&report, &options);

        // A recorded throw means the TypeScript render fails, so the port must fail too.
        if let Some(threw) = scenario.get("throws") {
            assert!(
                result.is_err(),
                "{name}: TypeScript threw {threw}, the port rendered HTML"
            );
            continue;
        }
        let actual = result.unwrap_or_else(|error| panic!("{name}: {error}"));
        let expected = expected.expect("recorded html");
        assert!(
            actual == expected,
            "{name}: {}",
            describe_difference(expected, &actual)
        );
    }
}
