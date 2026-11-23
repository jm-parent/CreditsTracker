//! The Rust port of `src/export-files.ts`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

mod pinned;

use crate::node_path;
use std::io;

/// Port of `getExportFilePath` (`src/export-files.ts:129`).
pub fn get_export_file_path(selected_path: String) -> Result<String, String> {
    let extension = node_path::extname(&selected_path);
    let lower = extension.to_lowercase();
    if lower != ".html" && lower != ".htm" && lower != ".csv" {
        return Ok(format!("{selected_path}.html"));
    }

    let directory = node_path::dirname(&selected_path);
    let stem = node_path::basename(&selected_path, Some(&extension));
    Ok(node_path::join(&[&directory, &format!("{stem}.html")]))
}

/// Mirrors `src/export-files.ts`'s `ExportTarget` interface: one destination file plus its
/// staged (write-then-rename) and backup paths and publish/backup bookkeeping.
struct ExportTarget {
    destination_path: String,
    staged_path: String,
    backup_path: String,
    contents: String,
    backup_created: bool,
    published: bool,
}

/// Port of `createTempToken` (`src/export-files.ts:12`): `${pid}-${now}-${random hex}`, the same
/// shape `Math.random().toString(16).slice(2)` produces (base 16 is a power of two, so the
/// conversion is exact: the hex digits of the pinned/real 32-bit draw, trailing zero nibbles
/// trimmed, as V8 trims them).
fn create_temp_token() -> String {
    let pid = std::process::id();
    let now_ms = pinned::now_ms().floor() as i64;
    let draw = pinned::next_u32();
    let hex = if draw == 0 {
        String::new()
    } else {
        format!("{draw:08x}").trim_end_matches('0').to_string()
    };
    format!("{pid}-{now_ms}-{hex}")
}

/// Port of `createTarget` (`src/export-files.ts:16`).
fn create_target(destination_path: &str, contents: &str, token: &str) -> ExportTarget {
    let directory = node_path::dirname(destination_path);
    let file_name = node_path::basename(destination_path, None);
    ExportTarget {
        destination_path: destination_path.to_string(),
        staged_path: node_path::join(&[&directory, &format!("{file_name}.{token}.staged")]),
        backup_path: node_path::join(&[&directory, &format!("{file_name}.{token}.backup")]),
        contents: contents.to_string(),
        backup_created: false,
        published: false,
    }
}

/// Node's `code: message, syscall 'path'[ -> 'dest']` shape for a filesystem error
/// (`internal/errors.js`'s `uvException`, as `src/export-files.ts`'s callers observe it via
/// `error.message`). Only the two codes this unit's recorded cases ever raise (`ENOENT`,
/// `EINVAL`) are mapped from the Windows error codes `std::io::Error` carries; anything else
/// keeps Rust's own message so a genuinely new failure is still visible, just not node-shaped.
fn node_fs_error(error: &io::Error, syscall: &str, path: &str, dest: Option<&str>) -> String {
    let mapped = match error.raw_os_error() {
        Some(2) | Some(3) => Some(("ENOENT", "no such file or directory")),
        Some(123) => Some(("EINVAL", "invalid argument")),
        Some(5) => Some(("EACCES", "permission denied")),
        Some(80) => Some(("EEXIST", "file already exists")),
        _ => match error.kind() {
            io::ErrorKind::NotFound => Some(("ENOENT", "no such file or directory")),
            io::ErrorKind::InvalidFilename | io::ErrorKind::InvalidInput => {
                Some(("EINVAL", "invalid argument"))
            }
            io::ErrorKind::PermissionDenied => Some(("EACCES", "permission denied")),
            io::ErrorKind::AlreadyExists => Some(("EEXIST", "file already exists")),
            _ => None,
        },
    };
    let (code, desc) = mapped.unwrap_or(("UNKNOWN", ""));
    match (mapped, dest) {
        (Some(_), Some(d)) => format!("{code}: {desc}, {syscall} '{path}' -> '{d}'"),
        (Some(_), None) => format!("{code}: {desc}, {syscall} '{path}'"),
        (None, _) => format!("{error}"),
    }
}

/// Port of `pathExists` (`src/export-files.ts:30`).
fn path_exists(path: &str) -> Result<bool, String> {
    match std::fs::metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(node_fs_error(&error, "access", path, None)),
    }
}

/// Port of `removeFileIfPresent` (`src/export-files.ts:41`).
fn remove_file_if_present(path: &str) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(node_fs_error(&error, "unlink", path, None)),
    }
}

/// Port of `cleanupTemporaryFiles` (`src/export-files.ts:58`).
fn cleanup_temporary_files(targets: &[ExportTarget], include_backups: bool) -> Vec<String> {
    let mut errors = Vec::new();
    for target in targets {
        let mut paths = vec![target.staged_path.as_str()];
        if include_backups {
            paths.push(target.backup_path.as_str());
        }
        for path in paths {
            if let Err(error) = remove_file_if_present(path) {
                errors.push(error);
            }
        }
    }
    errors
}

/// Port of `rollbackPublishedFiles` (`src/export-files.ts:78`).
fn rollback_published_files(targets: &mut [ExportTarget]) -> Vec<String> {
    let mut errors = Vec::new();

    for target in targets.iter().rev() {
        if !target.published {
            continue;
        }
        if let Err(error) = remove_file_if_present(&target.destination_path) {
            errors.push(error);
        }
    }

    let mut backup_restore_failed = false;
    for target in targets.iter_mut().rev() {
        if !target.backup_created {
            continue;
        }
        match std::fs::rename(&target.backup_path, &target.destination_path) {
            Ok(()) => target.backup_created = false,
            Err(error) => {
                backup_restore_failed = true;
                errors.push(node_fs_error(
                    &error,
                    "rename",
                    &target.backup_path,
                    Some(&target.destination_path),
                ));
            }
        }
    }

    errors.extend(cleanup_temporary_files(targets, !backup_restore_failed));
    errors
}

/// Port of `toCombinedError` (`src/export-files.ts:109`): `AggregateError`'s `.message` is just
/// the string passed as its second constructor argument, so that string is the whole of what
/// `src/export-files.ts`'s callers observe through `error.message` — the individual follow-up
/// errors are not appended.
fn to_combined_error(original_error: String, followup_errors: &[String]) -> String {
    if followup_errors.is_empty() {
        return original_error;
    }
    format!("Failed to publish export files: {original_error}. Rollback also failed.")
}

/// Port of `writeExportFile` (`src/export-files.ts:145`).
pub async fn write_export_file(destination_path: String, contents: String) -> Result<(), String> {
    let token = create_temp_token();
    let mut targets = vec![create_target(&destination_path, &contents, &token)];

    let publish_result: Result<(), String> = (|| {
        for target in &targets {
            std::fs::write(&target.staged_path, &target.contents)
                .map_err(|error| node_fs_error(&error, "open", &target.staged_path, None))?;
        }

        for target in &mut targets {
            if path_exists(&target.destination_path)? {
                std::fs::rename(&target.destination_path, &target.backup_path).map_err(
                    |error| {
                        node_fs_error(
                            &error,
                            "rename",
                            &target.destination_path,
                            Some(&target.backup_path),
                        )
                    },
                )?;
                target.backup_created = true;
            }

            std::fs::rename(&target.staged_path, &target.destination_path).map_err(|error| {
                node_fs_error(
                    &error,
                    "rename",
                    &target.staged_path,
                    Some(&target.destination_path),
                )
            })?;
            target.published = true;
        }

        Ok(())
    })();

    if let Err(original_error) = publish_result {
        let followup_errors = rollback_published_files(&mut targets);
        return Err(to_combined_error(original_error, &followup_errors));
    }

    let cleanup_errors = cleanup_temporary_files(&targets, true);
    if let Some((first, rest)) = cleanup_errors.split_first() {
        return Err(to_combined_error(first.clone(), rest));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_html_to_a_non_ascii_base_name() {
        let path = get_export_file_path("Rapport caf\u{e9} \u{1f680}".to_string()).unwrap();
        assert_eq!(path, "Rapport caf\u{e9} \u{1f680}.html");
    }

    #[test]
    fn swaps_a_recognized_extension_for_html_in_place() {
        let path = get_export_file_path("C:\\reports\\out.CSV".to_string()).unwrap();
        assert_eq!(path, "C:\\reports\\out.html");
    }

    #[test]
    fn writes_the_recorded_path_for_a_non_ascii_base_name() {
        let dir = tempfile::tempdir().unwrap();
        let selected = dir
            .path()
            .join("Rapport caf\u{e9} \u{1f680}")
            .to_string_lossy()
            .into_owned();
        let destination = get_export_file_path(selected.clone()).unwrap();
        assert_eq!(destination, format!("{selected}.html"));

        futures::executor::block_on(write_export_file(
            destination.clone(),
            "<html>caf\u{e9}</html>".to_string(),
        ))
        .unwrap();

        let written = std::fs::read_to_string(&destination).unwrap();
        assert_eq!(written, "<html>caf\u{e9}</html>");
    }

    #[test]
    fn errors_without_writing_when_the_parent_folder_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir
            .path()
            .join("missing-parent")
            .join("report.html")
            .to_string_lossy()
            .into_owned();

        let error = futures::executor::block_on(write_export_file(
            destination.clone(),
            "<html></html>".to_string(),
        ))
        .unwrap_err();

        assert!(error.starts_with("ENOENT:"), "unexpected error: {error}");
        assert!(!std::path::Path::new(&destination).exists());
    }
}
