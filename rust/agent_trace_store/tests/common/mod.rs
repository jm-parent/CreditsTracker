#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};

/// A fresh folder under the Cargo target directory, so tests never write outside the build output.
pub fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join("agent-trace-store")
        .join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("scratch folder");
    dir
}
