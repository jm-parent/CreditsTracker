//! A port of Node's `path` module (`path.win32`, the default on Windows) covering exactly the
//! four functions `src/export-files.ts` calls: `extname`, `dirname`, `basename` (with and
//! without a suffix) and `join`. Ported from `lib/path.js` in the Node.js source so drive
//! letters, UNC roots (`\\server\share\...`), trailing/leading dots and `.`/`..` segments
//! match the recording byte-for-byte.
//!
//! `dirname` and `normalize` restore Node's UNC share-root scan (`scan_unc_root`): a
//! destination like `\\server\share\Reports\usage.html` keeps its `\\server\share` root
//! intact end to end, instead of collapsing to a single leading backslash. `normalize` does
//! skip two exotic Node branches that are unreachable from a Windows save dialog's output —
//! see the `ponytail:` note on it.
//!
//! Operates on `Vec<char>` (Unicode scalar values) rather than UTF-16 code units: every
//! character these algorithms treat specially (`/`, `\`, `.`, `:`, ASCII letters) is a single
//! scalar value in both encodings, so slicing at the same scalar boundaries Node slices at
//! (by UTF-16 unit) yields the same substrings.

fn is_sep(c: char) -> bool {
    c == '/' || c == '\\'
}

/// Advances `j` over a run of separators (`want_sep`) or non-separators (`!want_sep`),
/// stopping at `chars.len()` if it runs out first.
fn skip_run(chars: &[char], mut j: usize, want_sep: bool) -> usize {
    while j < chars.len() && is_sep(chars[j]) == want_sep {
        j += 1;
    }
    j
}

/// Shared UNC-root scanner for `dirname` and `normalize`. `chars[0]` must already be known to
/// be a separator; returns `None` if `chars[1]` isn't a second one or there's no complete
/// server/share pair (so the caller's single-separator-root handling applies instead). Matches
/// Node's "server name, then share name" double-scan (`lib/path.js`'s nested loops in both
/// functions). Returns `(server_end, share_start, share_end, root_only)` on a match —
/// `chars[2..server_end]` is the server name, `chars[share_start..share_end]` the share name,
/// and `root_only` is true when the path is exactly `\\server\share` with nothing after it.
fn scan_unc_root(chars: &[char]) -> Option<(usize, usize, usize, bool)> {
    let len = chars.len();
    if len < 2 || !is_sep(chars[1]) {
        return None;
    }
    let server_end = skip_run(chars, 2, false);
    let share_start = skip_run(chars, server_end, true);
    let share_end = skip_run(chars, share_start, false);
    let matched = server_end < len && share_start < len;
    matched.then_some((server_end, share_start, share_end, share_end == len))
}

/// Port of `win32.extname`.
pub fn extname(path: &str) -> String {
    let chars: Vec<char> = path.chars().collect();
    let len = chars.len();
    let mut start = 0usize;
    let mut start_part = 0usize;
    let mut start_dot: isize = -1;
    let mut end: isize = -1;
    let mut matched_slash = true;
    let mut pre_dot_state = 0i32;

    if len >= 2 && chars[1] == ':' && chars[0].is_ascii_alphabetic() {
        start = 2;
        start_part = 2;
    }

    let mut i: isize = len as isize - 1;
    while i >= start as isize {
        let idx = i as usize;
        let code = chars[idx];
        if is_sep(code) {
            if !matched_slash {
                start_part = idx + 1;
                break;
            }
            i -= 1;
            continue;
        }
        if end == -1 {
            matched_slash = false;
            end = (idx + 1) as isize;
        }
        if code == '.' {
            if start_dot == -1 {
                start_dot = idx as isize;
            } else if pre_dot_state != 1 {
                pre_dot_state = 1;
            }
        } else if start_dot != -1 {
            pre_dot_state = -1;
        }
        i -= 1;
    }

    if start_dot == -1
        || end == -1
        || pre_dot_state == 0
        || (pre_dot_state == 1 && start_dot == end - 1 && start_dot == start_part as isize + 1)
    {
        return String::new();
    }
    chars[start_dot as usize..end as usize].iter().collect()
}

/// Port of `win32.dirname`.
pub fn dirname(path: &str) -> String {
    let chars: Vec<char> = path.chars().collect();
    let len = chars.len();
    if len == 0 {
        return ".".to_string();
    }
    let code = chars[0];
    if len == 1 {
        return if is_sep(code) {
            path.to_string()
        } else {
            ".".to_string()
        };
    }

    let mut root_end: isize = -1;
    let mut offset = 0usize;

    if is_sep(code) {
        // Possible UNC root.
        root_end = 1;
        offset = 1;

        if let Some((_, _, share_end, root_only)) = scan_unc_root(&chars) {
            if root_only {
                return path.to_string(); // Matched a UNC root only.
            }
            // We matched a UNC root with leftovers: offset by 1 to include the separator
            // after the UNC root, treating it as a "normal root" on top of a (UNC) root.
            root_end = (share_end + 1) as isize;
            offset = share_end + 1;
        }
    } else if code.is_ascii_alphabetic() && chars[1] == ':' {
        // Possible device root.
        root_end = if len > 2 && is_sep(chars[2]) { 3 } else { 2 };
        offset = root_end as usize;
    }

    let trimmed_end = chars[offset..len]
        .iter()
        .rposition(|&c| !is_sep(c))
        .map_or(offset, |p| offset + p + 1);
    let end: isize = chars[offset..trimmed_end]
        .iter()
        .rposition(|&c| is_sep(c))
        .map_or(-1, |p| (offset + p) as isize);

    if end == -1 {
        if root_end == -1 {
            return ".".to_string();
        }
        return chars[0..root_end as usize].iter().collect();
    }
    chars[0..end as usize].iter().collect()
}

/// Port of `win32.basename`. `ext`, when given, is stripped from the end of the base name if it
/// matches exactly (mirroring the source's `path.basename(selectedPath, extension)` call).
pub fn basename(path: &str, ext: Option<&str>) -> String {
    let chars: Vec<char> = path.chars().collect();
    let len = chars.len();
    let mut start = 0usize;
    let mut end: isize = -1;
    let mut matched_slash = true;

    if len >= 2 && chars[0].is_ascii_alphabetic() && chars[1] == ':' {
        start = 2;
    }

    if let Some(ext) = ext {
        let ext_chars: Vec<char> = ext.chars().collect();
        if !ext_chars.is_empty() && ext_chars.len() <= len {
            if ext == path {
                return String::new();
            }
            let mut ext_idx: isize = ext_chars.len() as isize - 1;
            let mut first_non_slash_end: isize = -1;
            let mut i: isize = len as isize - 1;
            while i >= start as isize {
                let idx = i as usize;
                let code = chars[idx];
                if is_sep(code) {
                    if !matched_slash {
                        start = idx + 1;
                        break;
                    }
                } else {
                    if first_non_slash_end == -1 {
                        matched_slash = false;
                        first_non_slash_end = (idx + 1) as isize;
                    }
                    if ext_idx >= 0 {
                        if code == ext_chars[ext_idx as usize] {
                            ext_idx -= 1;
                            if ext_idx == -1 {
                                end = idx as isize;
                            }
                        } else {
                            ext_idx = -1;
                            end = first_non_slash_end;
                        }
                    }
                }
                i -= 1;
            }

            if start as isize == end {
                end = first_non_slash_end;
            } else if end == -1 {
                end = len as isize;
            }
            return chars[start..end as usize].iter().collect();
        }
    }

    let mut i: isize = len as isize - 1;
    while i >= start as isize {
        let idx = i as usize;
        if is_sep(chars[idx]) {
            if !matched_slash {
                start = idx + 1;
                break;
            }
        } else if end == -1 {
            matched_slash = false;
            end = (idx + 1) as isize;
        }
        i -= 1;
    }

    if end == -1 {
        return String::new();
    }
    chars[start..end as usize].iter().collect()
}

/// `.`/`..` segment resolution for `normalize`'s tail (not byte-for-byte with Node's
/// `normalizeString`: e.g. a trailing bare `..` is dropped here rather than always kept when
/// `allow_above_root`). `normalize`'s only caller is `join`, reached solely from
/// `get_export_file_path`'s recognized-extension branch (`.html`/`.htm`/`.csv`) with a
/// destination that always comes from a native save dialog and so is always absolute
/// (`allow_above_root` is always `false` here) — for an absolute path this collapse already
/// matches Node exactly (confirmed against `node -e` for every recorded and listed case,
/// including `C:\a\..\b\x.html`); the two algorithms can only disagree on a relative path with
/// a leading `..`, which never reaches this function. Upgrade path: restore the byte-for-byte
/// algorithm from `lib/path.js`'s `normalizeString` if that ever changes.
fn normalize_string(path: &[char], allow_above_root: bool, separator: char) -> Vec<char> {
    let text: String = path.iter().collect();
    let mut segments: Vec<&str> = Vec::new();
    for segment in text.split(['/', '\\']) {
        match segment {
            "" | "." => {}
            ".." => match segments.last() {
                Some(&last) if last != ".." => {
                    segments.pop();
                }
                _ if allow_above_root => segments.push(".."),
                _ => {}
            },
            other => segments.push(other),
        }
    }
    segments.join(&separator.to_string()).chars().collect()
}

/// Port of `win32.normalize`.
///
/// ponytail: Node also special-cases a `\\.\`/`\\?\` device-path UNC root and a bare
/// drive-relative/colon path (`C:foo`, including the CVE-2024-36139 re-escape guard) or a
/// Windows reserved device name (`CON`, `COM1`, ...) elsewhere in `path`. None of those are
/// reachable here: `selected_path` always comes from a native Windows save dialog, which only
/// ever returns a drive-letter-absolute or `\\server\share\...` path — never a device path, a
/// colon past position 1, or a reserved name (the dialog itself rejects one). Upgrade path:
/// the matching `else`/device-path branches in `lib/path.js`'s `normalize`.
fn normalize(path: &str) -> String {
    let chars: Vec<char> = path.chars().collect();
    let len = chars.len();
    if len == 0 {
        return ".".to_string();
    }
    let code = chars[0];
    if len == 1 {
        return if code == '/' {
            "\\".to_string()
        } else {
            path.to_string()
        };
    }

    let mut root_end = 0usize;
    let mut device: Option<String> = None;
    let mut is_absolute = false;

    if is_sep(code) {
        is_absolute = true;

        if let Some((server_end, share_start, share_end, root_only)) = scan_unc_root(&chars) {
            let first_part: String = chars[2..server_end].iter().collect();
            if root_only {
                // We matched a UNC root only: return its normalized form, nothing
                // left to process.
                let share: String = chars[share_start..].iter().collect();
                return format!("\\\\{first_part}\\{share}\\");
            }
            // We matched a UNC root with leftovers.
            let share: String = chars[share_start..share_end].iter().collect();
            device = Some(format!("\\\\{first_part}\\{share}"));
            root_end = share_end;
        } else if !is_sep(chars[1]) {
            root_end = 1;
        }
    } else if code.is_ascii_alphabetic() && chars[1] == ':' {
        device = Some(chars[0..2].iter().collect());
        root_end = 2;
        if len > 2 && is_sep(chars[2]) {
            is_absolute = true;
            root_end = 3;
        }
    }

    let mut tail: Vec<char> = if root_end < len {
        normalize_string(&chars[root_end..], !is_absolute, '\\')
    } else {
        Vec::new()
    };

    if tail.is_empty() && !is_absolute {
        tail.push('.');
    }
    if !tail.is_empty() && is_sep(chars[len - 1]) {
        tail.push('\\');
    }

    let tail: String = tail.into_iter().collect();
    let device = device.unwrap_or_default();
    if is_absolute {
        format!("{device}\\{tail}")
    } else {
        format!("{device}{tail}")
    }
}

/// Port of `win32.join`.
pub fn join(parts: &[&str]) -> String {
    let non_empty: Vec<&str> = parts.iter().copied().filter(|p| !p.is_empty()).collect();
    if non_empty.is_empty() {
        return ".".to_string();
    }
    normalize(&non_empty.join("\\"))
}
