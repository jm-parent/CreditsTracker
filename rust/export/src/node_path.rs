//! A port of Node's `path` module (`path.win32`, the default on Windows) covering exactly the
//! four functions `src/export-files.ts` calls: `extname`, `dirname`, `basename` (with and
//! without a suffix) and `join`. Ported from `lib/path.js` in the Node.js source so drive
//! letters, trailing/leading dots and `.`/`..` segments match the recording byte-for-byte.
//!
//! UNC roots (`\\server\share\...`) are not specially preserved (see the `ponytail:` notes on
//! `dirname` and `normalize`): no recorded case, and no realistic native-dialog save path
//! (always drive-letter absolute), exercises one.
//!
//! Operates on `Vec<char>` (Unicode scalar values) rather than UTF-16 code units: every
//! character these algorithms treat specially (`/`, `\`, `.`, `:`, ASCII letters) is a single
//! scalar value in both encodings, so slicing at the same scalar boundaries Node slices at
//! (by UTF-16 unit) yields the same substrings.

fn is_sep(c: char) -> bool {
    c == '/' || c == '\\'
}

fn is_device_root(c: char) -> bool {
    c.is_ascii_alphabetic()
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

    if len >= 2 && chars[1] == ':' && is_device_root(chars[0]) {
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

    // ponytail: UNC roots (`\\server\share\...`) aren't specially preserved here, unlike
    // Node's `win32.dirname` — a save path typed as a literal UNC path could see its share
    // root over-stripped. No recorded case (and no realistic native-dialog path, which is
    // always drive-letter absolute) exercises this; upgrade path is Node's nested
    // double-separator scan in `lib/path.js`'s `dirname` if UNC export targets are needed.
    if is_sep(code) {
        root_end = 1;
        offset = 1;
    } else if is_device_root(code) && chars[1] == ':' {
        root_end = if len > 2 && is_sep(chars[2]) { 3 } else { 2 };
        offset = root_end as usize;
    }

    let mut end: isize = -1;
    let mut matched_slash = true;
    let mut i: isize = len as isize - 1;
    while i >= offset as isize {
        let idx = i as usize;
        if is_sep(chars[idx]) {
            if !matched_slash {
                end = idx as isize;
                break;
            }
        } else {
            matched_slash = false;
        }
        i -= 1;
    }

    if end == -1 {
        if root_end == -1 {
            return ".".to_string();
        }
        end = root_end;
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

    if len >= 2 && is_device_root(chars[0]) && chars[1] == ':' {
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

/// A simplified `.`/`..` segment resolution for `normalize`'s tail.
///
/// ponytail: not Node's `normalizeString` bit-for-bit (e.g. a trailing bare `..` is dropped
/// here rather than always kept when `allow_above_root`). `join` — this function's only
/// caller — is reached solely from `get_export_file_path`'s recognized-extension branch
/// (`.html`/`.htm`/`.csv`), which no recorded case or written test exercises (a native save
/// dialog never returns a path with `.`/`..` segments), so a short, good-enough collapse is
/// used instead of the full Node algorithm. Upgrade path: restore the byte-for-byte algorithm
/// from `lib/path.js`'s `normalizeString` if dot-segment-bearing export paths need exact
/// parity.
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
fn normalize(path: &str) -> String {
    let chars: Vec<char> = path.chars().collect();
    let len = chars.len();
    if len == 0 {
        return ".".to_string();
    }
    let code = chars[0];
    if len == 1 {
        return if is_sep(code) {
            "\\".to_string()
        } else {
            path.to_string()
        };
    }

    let mut root_end = 0usize;
    let mut device: Option<String> = None;
    let mut is_absolute = false;

    // ponytail: see the matching note on `dirname` — UNC share roots aren't specially
    // preserved here either, only a single leading separator or a drive letter.
    if is_sep(code) {
        is_absolute = true;
        root_end = 1;
    } else if is_device_root(code) && chars[1] == ':' {
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
    match device {
        None => {
            if is_absolute {
                if !tail.is_empty() {
                    format!("\\{tail}")
                } else {
                    "\\".to_string()
                }
            } else if !tail.is_empty() {
                tail
            } else {
                String::new()
            }
        }
        Some(device) => {
            if is_absolute {
                if !tail.is_empty() {
                    format!("{device}\\{tail}")
                } else {
                    format!("{device}\\")
                }
            } else if !tail.is_empty() {
                format!("{device}{tail}")
            } else {
                device
            }
        }
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
