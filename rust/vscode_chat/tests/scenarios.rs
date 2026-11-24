//! Replays the scenarios recorded from the TypeScript reference by
//! `reference/scenarios/vscode-chat-scenarios.ts` against the synthetic logs under `fixtures/vscode/`.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use vscode_chat::port::{
    VscodeUsageData, load_vscode_usage, parse_chat_session_file,
    resolve_default_workspace_storage_dir,
};

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Outcome<T> {
    Ok(T),
    Threw(String),
}

#[derive(Deserialize)]
#[serde(tag = "call")]
enum Scenario {
    #[serde(rename = "parseChatSessionFile")]
    Parse {
        name: String,
        file: String,
        project: Option<String>,
        outcome: Outcome<VscodeUsageData>,
    },
    #[serde(rename = "loadVscodeUsage")]
    Load {
        name: String,
        dir: String,
        outcome: Outcome<VscodeUsageData>,
    },
    #[serde(rename = "resolveDefaultWorkspaceStorageDir")]
    Resolve {
        name: String,
        outcome: Outcome<String>,
    },
}

#[test]
fn replays_every_recorded_scenario() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.join("..").join("..");
    let text = std::fs::read_to_string(manifest.join("tests/fixtures/scenarios.json")).unwrap();
    let scenarios: Vec<Scenario> = serde_json::from_str(&text).unwrap();
    let home = std::env::home_dir().expect("a home folder");

    for scenario in scenarios {
        match scenario {
            Scenario::Parse {
                name,
                file,
                project,
                outcome,
            } => {
                let actual = parse_chat_session_file(&root.join(&file), project.as_deref());
                match outcome {
                    Outcome::Ok(expected) => assert_eq!(actual, Ok(expected), "{name}"),
                    Outcome::Threw(error) => assert!(
                        actual
                            .as_ref()
                            .err()
                            .is_some_and(|e| e.starts_with(&format!("{error}: "))),
                        "{name}: expected {error}, got {actual:?}"
                    ),
                }
            }
            Scenario::Load { name, dir, outcome } => match outcome {
                Outcome::Ok(expected) => {
                    assert_eq!(load_vscode_usage(&root.join(&dir)), expected, "{name}")
                }
                Outcome::Threw(error) => panic!("{name}: load never throws, recorded {error}"),
            },
            Scenario::Resolve { name, outcome } => {
                let actual: PathBuf = resolve_default_workspace_storage_dir();
                let relative = actual.strip_prefix(&home).expect("under the home folder");
                match outcome {
                    Outcome::Ok(expected) => assert_eq!(relative, Path::new(&expected), "{name}"),
                    Outcome::Threw(error) => {
                        panic!("{name}: resolve never throws, recorded {error}")
                    }
                }
            }
        }
    }
}
