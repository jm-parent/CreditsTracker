//! The JavaScript values the sanitizer reads, with the JS rules it depends on: property reads,
//! truthiness, `BigInt(...)`, `String(...)`, `JSON.parse` and `JSON.stringify`.
//!
//! Errors are returned as the message the TypeScript code throws, prefixed with the error class
//! (`TypeError: ...`) so the JS bridge can raise the same error type.

use std::collections::HashMap;

use serde_json::{Map, Value, json};

/// A JavaScript value. `Undefined` and `Bytes` (a `Uint8Array`) are kept apart from `Null` and
/// `Object`, so a key-value list whose keys look like markers never turns into bytes.
#[derive(Debug, Clone, PartialEq)]
pub enum Js {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Bytes(Vec<u8>),
    Array(Vec<Js>),
    Object(Vec<(String, Js)>),
}

pub type JsResult<T> = Result<T, String>;

/// Keys that `index.cjs` wraps in `{"$object": ...}` when a client object has only that key.
const MARKERS: [&str; 10] = [
    "$undefined",
    "$utf16",
    "$num",
    "$bigint",
    "$date",
    "$bytes",
    "$object",
    "$buffer",
    "$map",
    "$set",
];

/// Builds a JS object from entries: a repeated key keeps its first position and takes the last
/// value, and integer-like keys come first in ascending order, as JS orders own properties.
pub fn object(entries: Vec<(String, Js)>) -> Js {
    let mut ordered: Vec<(String, Js)> = Vec::with_capacity(entries.len());
    let mut position: HashMap<String, usize> = HashMap::with_capacity(entries.len());
    for (key, value) in entries {
        match position.get(&key) {
            Some(&index) => ordered[index].1 = value,
            None => {
                position.insert(key.clone(), ordered.len());
                ordered.push((key, value));
            }
        }
    }
    let (mut indexes, names): (Vec<_>, Vec<_>) = ordered
        .into_iter()
        .partition(|(key, _)| array_index(key).is_some());
    indexes.sort_by_key(|(key, _)| array_index(key));
    indexes.extend(names);
    Js::Object(indexes)
}

fn array_index(key: &str) -> Option<u64> {
    let canonical = key == "0" || (!key.starts_with('0') && !key.is_empty());
    if !canonical || !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    key.parse::<u64>()
        .ok()
        .filter(|index| *index < 4_294_967_295)
}

/// `target[key]`. Reading a property of `null` or `undefined` throws, as JS does.
pub fn get(target: &Js, key: &str) -> JsResult<Js> {
    match target {
        Js::Object(entries) => Ok(entries
            .iter()
            .find(|(name, _)| name == key)
            .map_or(Js::Undefined, |(_, value)| value.clone())),
        Js::Undefined | Js::Null => Err(format!(
            "TypeError: Cannot read properties of {} (reading '{key}')",
            if *target == Js::Null {
                "null"
            } else {
                "undefined"
            }
        )),
        _ => Ok(Js::Undefined),
    }
}

pub fn truthy(value: &Js) -> bool {
    match value {
        Js::Undefined | Js::Null => false,
        Js::Bool(flag) => *flag,
        Js::Number(n) => *n != 0.0 && !n.is_nan(),
        Js::String(text) => !text.is_empty(),
        _ => true,
    }
}

/// `String(value)` for the values that have one; objects print as `[object Object]`.
pub fn to_js_string(value: &Js) -> String {
    match value {
        Js::Undefined => "undefined".into(),
        Js::Null => "null".into(),
        Js::Bool(flag) => flag.to_string(),
        Js::Number(n) => number_to_string(*n),
        Js::String(text) => text.clone(),
        Js::Bytes(bytes) => bytes
            .iter()
            .map(u8::to_string)
            .collect::<Vec<_>>()
            .join(","),
        Js::Array(items) => items
            .iter()
            .map(|item| match item {
                Js::Undefined | Js::Null => String::new(),
                other => to_js_string(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        Js::Object(_) => "[object Object]".into(),
    }
}

/// `Number.prototype.toString()`: the shortest round-trip digits, JS spelling.
pub fn number_to_string(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n == 0.0 {
        return "0".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    let sign = if n < 0.0 { "-" } else { "" };
    let scientific = format!("{:e}", n.abs());
    let (mantissa, exponent) = scientific
        .split_once('e')
        .expect("LowerExp output has an exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i64;
    let point: i64 = exponent
        .parse::<i64>()
        .expect("LowerExp exponent is an integer")
        + 1;
    let body = if k <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - k) as usize))
    } else if 0 < point && point <= 21 {
        format!(
            "{}.{}",
            &digits[..point as usize],
            &digits[point as usize..]
        )
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat((-point) as usize))
    } else {
        let exp = point - 1;
        let mark = if exp >= 0 { "+" } else { "-" };
        let head = if k == 1 {
            digits.clone()
        } else {
            format!("{}.{}", &digits[..1], &digits[1..])
        };
        format!("{head}e{mark}{}", exp.abs())
    };
    format!("{sign}{body}")
}

/// `JSON.stringify` for a sanitized value: JS string quoting, non-finite numbers as `null`,
/// `undefined` properties left out.
pub fn to_json_text(value: &Js) -> JsResult<String> {
    let mut out = String::new();
    write_json(value, &mut out)?;
    Ok(out)
}

fn write_json(value: &Js, out: &mut String) -> JsResult<()> {
    match value {
        Js::Undefined | Js::Null => out.push_str("null"),
        Js::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Js::Number(n) if n.is_finite() => out.push_str(&number_to_string(*n)),
        Js::Number(_) => out.push_str("null"),
        Js::String(text) => write_json_string(text, out),
        Js::Bytes(_) => return Err("TypeError: Binary content cannot be serialized".into()),
        Js::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_json(item, out)?;
            }
            out.push(']');
        }
        Js::Object(entries) => {
            out.push('{');
            let mut first = true;
            for (key, item) in entries.iter().filter(|(_, item)| *item != Js::Undefined) {
                if !first {
                    out.push(',');
                }
                first = false;
                write_json_string(key, out);
                out.push(':');
                write_json(item, out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

fn write_json_string(text: &str, out: &mut String) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// `JSON.parse` of text that came from a string value. Its objects have no markers.
pub fn parse_json(text: &str) -> Option<Js> {
    crate::js::from_json::<Value>(text)
        .ok()
        .map(|value| from_plain_json(&value))
}

fn from_plain_json(value: &Value) -> Js {
    match value {
        Value::Null => Js::Null,
        Value::Bool(flag) => Js::Bool(*flag),
        Value::Number(n) => Js::Number(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(text) => Js::String(text.clone()),
        Value::Array(items) => Js::Array(items.iter().map(from_plain_json).collect()),
        Value::Object(map) => object(
            map.iter()
                .map(|(key, item)| (key.clone(), from_plain_json(item)))
                .collect(),
        ),
    }
}

/// A value received from the JS bridge, with the markers `index.cjs` uses for what JSON lacks.
pub fn from_value(value: &Value) -> JsResult<Js> {
    Ok(match value {
        Value::Null => Js::Null,
        Value::Bool(flag) => Js::Bool(*flag),
        Value::Number(n) => Js::Number(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(text) => Js::String(text.clone()),
        Value::Array(items) => Js::Array(items.iter().map(from_value).collect::<JsResult<_>>()?),
        Value::Object(map) => {
            if let Some((key, inner)) = map
                .iter()
                .next()
                .filter(|(key, _)| map.len() == 1 && MARKERS.contains(&key.as_str()))
            {
                return from_marker(key, inner);
            }
            object(
                map.iter()
                    .map(|(key, item)| Ok((key.clone(), from_value(item)?)))
                    .collect::<JsResult<_>>()?,
            )
        }
    })
}

fn from_marker(key: &str, inner: &Value) -> JsResult<Js> {
    let unsupported = || format!("TypeError: the {key} marker is not supported by the sanitizer");
    match key {
        "$undefined" => Ok(Js::Undefined),
        "$num" => match inner.as_str() {
            Some("NaN") => Ok(Js::Number(f64::NAN)),
            Some("Infinity") => Ok(Js::Number(f64::INFINITY)),
            Some("-Infinity") => Ok(Js::Number(f64::NEG_INFINITY)),
            Some("-0") => Ok(Js::Number(-0.0)),
            _ => Err(unsupported()),
        },
        "$bytes" => inner
            .as_array()
            .ok_or_else(unsupported)?
            .iter()
            .map(|byte| {
                byte.as_u64()
                    .and_then(|b| u8::try_from(b).ok())
                    .ok_or_else(unsupported)
            })
            .collect::<JsResult<Vec<u8>>>()
            .map(Js::Bytes),
        "$object" => match inner {
            Value::Object(map) => Ok(object(
                map.iter()
                    .map(|(name, item)| Ok((name.clone(), from_value(item)?)))
                    .collect::<JsResult<_>>()?,
            )),
            _ => Err(unsupported()),
        },
        "$utf16" => {
            let units = inner
                .as_array()
                .ok_or_else(unsupported)?
                .iter()
                .map(|unit| {
                    unit.as_u64()
                        .and_then(|u| u16::try_from(u).ok())
                        .ok_or_else(unsupported)
                })
                .collect::<JsResult<Vec<u16>>>()?;
            Ok(Js::String(String::from_utf16_lossy(&units)))
        }
        _ => Err(unsupported()),
    }
}

/// The JSON form `index.cjs` revives: `undefined`, `NaN` and bytes as markers, and an object whose
/// only key is a marker name wrapped in `$object`.
pub fn to_value(value: &Js) -> Value {
    match value {
        Js::Undefined => json!({ "$undefined": true }),
        Js::Null => Value::Null,
        Js::Bool(flag) => Value::Bool(*flag),
        Js::Number(n) => crate::js::number(*n),
        Js::String(text) => Value::String(text.clone()),
        Js::Bytes(bytes) => json!({ "$bytes": bytes }),
        Js::Array(items) => Value::Array(items.iter().map(to_value).collect()),
        Js::Object(entries) => {
            let map: Map<String, Value> = entries
                .iter()
                .map(|(key, item)| (key.clone(), to_value(item)))
                .collect();
            match entries.as_slice() {
                [(key, _)] if MARKERS.contains(&key.as_str()) => json!({ "$object": map }),
                _ => Value::Object(map),
            }
        }
    }
}

/// `BigInt(value)`.
pub fn to_bigint(value: &Js) -> JsResult<i128> {
    match value {
        Js::Bool(flag) => Ok(i128::from(*flag)),
        Js::Number(n) if n.is_finite() && n.fract() == 0.0 => Ok(*n as i128),
        Js::Number(n) => Err(format!(
            "RangeError: The number {} cannot be converted to a BigInt because it is not an integer",
            number_to_string(*n)
        )),
        Js::Undefined => Err("TypeError: Cannot convert undefined to a BigInt".into()),
        Js::Null => Err("TypeError: Cannot convert null to a BigInt".into()),
        Js::String(text) => string_to_bigint(text),
        Js::Array(_) | Js::Bytes(_) | Js::Object(_) => string_to_bigint(&to_js_string(value)),
    }
}

/// `StringToBigInt`: whitespace around the number is ignored, and an empty string is zero.
fn string_to_bigint(text: &str) -> JsResult<i128> {
    let trimmed = text.trim_matches(is_js_whitespace);
    let radix_prefix = |lower: char, upper: char| {
        trimmed.strip_prefix('0').and_then(|rest| {
            rest.strip_prefix(lower)
                .or_else(|| rest.strip_prefix(upper))
        })
    };
    let parsed = if trimmed.is_empty() {
        Some(0)
    } else if let Some(digits) = radix_prefix('x', 'X') {
        parse_digits(digits, 16)
    } else if let Some(digits) = radix_prefix('o', 'O') {
        parse_digits(digits, 8)
    } else if let Some(digits) = radix_prefix('b', 'B') {
        parse_digits(digits, 2)
    } else {
        let (negative, digits) = match trimmed.as_bytes().first() {
            Some(b'-') => (true, &trimmed[1..]),
            Some(b'+') => (false, &trimmed[1..]),
            _ => (false, trimmed),
        };
        parse_digits(digits, 10).map(|value| if negative { -value } else { value })
    };
    parsed.ok_or_else(|| format!("SyntaxError: Cannot convert {text} to a BigInt"))
}

fn parse_digits(digits: &str, radix: u32) -> Option<i128> {
    if digits.is_empty() {
        return None;
    }
    digits.chars().try_fold(0i128, |value, c| {
        let digit = c.to_digit(radix)?;
        Some(
            value
                .saturating_mul(i128::from(radix))
                .saturating_add(i128::from(digit)),
        )
    })
}

/// The JS whitespace and line terminators that `String.prototype.trim` removes.
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// `new Date(ms).toISOString()`.
pub fn iso_from_millis(ms: i128) -> JsResult<String> {
    const LIMIT: i128 = 8_640_000_000_000_000;
    if ms.abs() > LIMIT {
        return Err("RangeError: Invalid time value".into());
    }
    let ms = ms as i64;
    let days = ms.div_euclid(86_400_000);
    let within_day = ms.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else if year < 0 {
        format!("-{:06}", -year)
    } else {
        format!("+{year:06}")
    };
    Ok(format!(
        "{year}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        within_day / 3_600_000,
        within_day / 60_000 % 60,
        within_day / 1000 % 60,
        within_day % 1000,
    ))
}

/// Days since 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_print_as_js_does() {
        assert_eq!(number_to_string(1e21), "1e+21");
        assert_eq!(number_to_string(1e-7), "1e-7");
        assert_eq!(
            number_to_string(123456789012345680000.0),
            "123456789012345680000"
        );
        assert_eq!(number_to_string(-0.0), "0");
        assert_eq!(number_to_string(0.000001), "0.000001");
    }

    #[test]
    fn integer_keys_come_first_in_ascending_order() {
        let built = object(vec![
            ("b".into(), Js::Null),
            ("2".into(), Js::Null),
            ("1".into(), Js::Null),
        ]);
        assert_eq!(
            to_json_text(&built).unwrap(),
            r#"{"1":null,"2":null,"b":null}"#
        );
    }

    #[test]
    fn iso_dates_match_to_iso_string() {
        assert_eq!(
            iso_from_millis(1_700_000_000_000).unwrap(),
            "2023-11-14T22:13:20.000Z"
        );
        assert_eq!(iso_from_millis(-1).unwrap(), "1969-12-31T23:59:59.999Z");
        assert!(iso_from_millis(8_640_000_000_000_001).is_err());
    }

    #[test]
    fn bigint_conversion_follows_string_rules() {
        assert_eq!(string_to_bigint("  42 ").unwrap(), 42);
        assert_eq!(string_to_bigint("0x1f").unwrap(), 31);
        assert_eq!(string_to_bigint("").unwrap(), 0);
        assert_eq!(
            string_to_bigint("a:b").unwrap_err(),
            "SyntaxError: Cannot convert a:b to a BigInt"
        );
    }
}
