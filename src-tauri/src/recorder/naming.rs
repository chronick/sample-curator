//! Rename fresh recordings with descriptive filenames.
//!
//! The primary path delegates to the Python sidecar's `name_recording`
//! handler, which produces a stem like `dark-kick_128bpm_Am` (CLAP
//! zero-shot) or `autumn-waterfall` (heroku-style fallback).
//!
//! If the sidecar isn't available — e.g. because optional ML deps aren't
//! installed, or the subprocess failed to spawn — this module falls back
//! to a Rust-side heroku-style generator so every recording gets a nicer
//! name than `session_YYYYMMDD_HHMMSS.wav`.

use std::path::{Path, PathBuf};

/// Result of auto-naming: the new path (unchanged if rename failed) plus
/// metadata about how the name was produced.
#[derive(Debug, Clone, serde::Serialize)]
pub struct AutoNameResult {
    pub new_path: String,
    pub stem: String,
    pub tags: Vec<String>,
    /// One of `"clap"`, `"heuristic"`, `"heroku"`, `"heroku-fallback"`
    /// (the last indicating the sidecar was unavailable).
    pub method: String,
}

/// Short, evocative word list for the Rust-side fallback. Kept intentionally
/// small; the full word lists live in the Python sidecar and are the primary
/// path. This list only runs when the sidecar is unreachable.
const ADJECTIVES: &[&str] = &[
    "autumn", "silver", "amber", "crimson", "ember", "frosted", "hollow", "wild", "quiet",
    "violet", "midnight", "restless", "drifting", "muted", "soft", "brittle", "molten", "still",
    "dusty", "warm", "distant", "neon", "salted", "faded", "gilded", "rusted", "hushed",
    "winter", "summer", "coastal",
];

const NOUNS: &[&str] = &[
    "waterfall", "meadow", "engine", "cove", "shadow", "ember", "signal", "ridge", "lantern",
    "harbor", "valley", "thicket", "cipher", "beacon", "mosaic", "atlas", "cascade", "nocturne",
    "drift", "echo", "glacier", "grove", "tundra", "lagoon", "canyon", "eddy", "lattice",
    "archive", "mirror", "prism",
];

/// Deterministic adjective-noun pair derived from `seed`. Uses a simple
/// FNV-1a hash to avoid pulling in md5/sha dependencies for this one use.
pub fn heroku_style_stem(seed: &str) -> String {
    let hash = fnv1a(seed.as_bytes());
    let adj = ADJECTIVES[(hash as usize) % ADJECTIVES.len()];
    let noun = NOUNS[((hash >> 16) as usize) % NOUNS.len()];
    format!("{}-{}", adj, noun)
}

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// Rename `path` to use `new_stem` (extension is preserved). Returns the
/// new path. If renaming fails, logs the error and returns the original
/// path unchanged — callers can treat the returned path as canonical either way.
pub fn rename_with_stem(path: &str, new_stem: &str) -> String {
    let original = PathBuf::from(path);
    let parent = match original.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => PathBuf::from("."),
    };
    let ext = original.extension().and_then(|e| e.to_str()).unwrap_or("wav");

    // Preserve a timestamp suffix from the original filename if one is
    // present (e.g. `_20260415_183012`). This keeps filenames unique even
    // when the same stem gets chosen twice within a minute.
    let timestamp_suffix = original
        .file_stem()
        .and_then(|s| s.to_str())
        .and_then(extract_timestamp_suffix)
        .unwrap_or_default();

    let new_name = if timestamp_suffix.is_empty() {
        format!("{}.{}", new_stem, ext)
    } else {
        format!("{}_{}.{}", new_stem, timestamp_suffix, ext)
    };
    let new_path = parent.join(&new_name);

    // If the target already exists (e.g. idempotent re-run), bail rather
    // than clobber — return the existing path.
    if new_path == original {
        return path.to_string();
    }
    if new_path.exists() {
        eprintln!(
            "Auto-name: target {} already exists; keeping original",
            new_path.display()
        );
        return path.to_string();
    }

    match std::fs::rename(&original, &new_path) {
        Ok(()) => new_path.to_string_lossy().to_string(),
        Err(e) => {
            eprintln!("Auto-name: rename failed ({}); keeping original", e);
            path.to_string()
        }
    }
}

/// Extract `YYYYMMDD_HHMMSS` suffix from a filename stem, if present.
/// Handles the existing recorder output like `session_20260415_183012`.
fn extract_timestamp_suffix(stem: &str) -> Option<String> {
    // Look for the last `_YYYYMMDD_HHMMSS` substring.
    let bytes = stem.as_bytes();
    if bytes.len() < 16 {
        return None;
    }
    // Walk backwards looking for `_NNNNNNNN_NNNNNN` at the end.
    let n = bytes.len();
    let tail = &bytes[n.saturating_sub(16)..];
    if tail[0] != b'_' || tail[9] != b'_' {
        return None;
    }
    for (i, &b) in tail.iter().enumerate() {
        match i {
            0 | 9 => {
                if b != b'_' {
                    return None;
                }
            }
            _ => {
                if !b.is_ascii_digit() {
                    return None;
                }
            }
        }
    }
    // Strip the leading `_` — rename_with_stem adds its own separator.
    Some(String::from_utf8_lossy(&tail[1..]).to_string())
}

/// Build the JSON-RPC request body for `name_recording`.
pub fn build_sidecar_request(id: u64, path: &str, bpm: Option<f64>, key: Option<&str>) -> String {
    // Hand-rolled JSON to avoid extra serde dependency footprint here and
    // because the payload is simple/fixed-shape.
    let mut params = format!("\"path\":{}", json_string(path));
    if let Some(b) = bpm {
        if b.is_finite() && b > 0.0 {
            params.push_str(&format!(",\"bpm\":{}", b));
        }
    }
    if let Some(k) = key {
        if !k.is_empty() {
            params.push_str(&format!(",\"key\":{}", json_string(k)));
        }
    }
    format!(
        "{{\"jsonrpc\":\"2.0\",\"method\":\"name_recording\",\"params\":{{{}}},\"id\":{}}}",
        params, id
    )
}

fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Parse the sidecar response and return an ``AutoNameResult`` on success.
/// Returns `None` on any parse error so the caller can fall back cleanly.
pub fn parse_sidecar_response(response: &str) -> Option<(String, Vec<String>, String)> {
    let v: serde_json::Value = serde_json::from_str(response).ok()?;
    let result = v.get("result")?;
    let stem = result.get("stem")?.as_str()?.to_string();
    let method = result
        .get("method")
        .and_then(|m| m.as_str())
        .unwrap_or("unknown")
        .to_string();
    let tags: Vec<String> = result
        .get("tags")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Some((stem, tags, method))
}

/// Sanitize a stem so it's safe as a filename on macOS/Linux/Windows.
/// Keeps `[a-zA-Z0-9_-]`, collapses runs of other characters to `-`.
pub fn sanitize_stem(stem: &str) -> String {
    let mut out = String::with_capacity(stem.len());
    let mut last_was_sep = false;
    for c in stem.chars() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
            out.push(c);
            last_was_sep = false;
        } else if !last_was_sep {
            out.push('-');
            last_was_sep = true;
        }
    }
    // Trim leading/trailing separators
    let trimmed = out.trim_matches(|c: char| c == '-' || c == '_').to_string();
    if trimmed.is_empty() {
        "recording".to_string()
    } else {
        trimmed
    }
}

/// Fallback path when the sidecar is unavailable: generate a heroku-style
/// stem from the existing filename and rename in place.
pub fn fallback_rename(path: &str) -> AutoNameResult {
    let seed = Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string();
    let stem = heroku_style_stem(&seed);
    let new_path = rename_with_stem(path, &stem);
    AutoNameResult {
        new_path,
        stem,
        tags: vec![],
        method: "heroku-fallback".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heroku_style_is_deterministic() {
        let a = heroku_style_stem("session_20260415_183012");
        let b = heroku_style_stem("session_20260415_183012");
        assert_eq!(a, b);
        assert!(a.contains('-'));
    }

    #[test]
    fn heroku_style_varies_across_seeds() {
        let a = heroku_style_stem("session_20260415_183012");
        let b = heroku_style_stem("session_20260415_183030");
        assert_ne!(a, b);
    }

    #[test]
    fn heroku_style_output_is_safe_filename() {
        let stem = heroku_style_stem("any-seed");
        for c in stem.chars() {
            assert!(
                c.is_ascii_alphanumeric() || c == '-' || c == '_',
                "unexpected char: {}",
                c
            );
        }
    }

    #[test]
    fn extract_timestamp_suffix_recognizes_recorder_format() {
        assert_eq!(
            extract_timestamp_suffix("session_20260415_183012"),
            Some("20260415_183012".to_string())
        );
        assert_eq!(
            extract_timestamp_suffix("kick_20260415_183012"),
            Some("20260415_183012".to_string())
        );
    }

    #[test]
    fn extract_timestamp_suffix_returns_none_for_mismatches() {
        assert_eq!(extract_timestamp_suffix("no-timestamp"), None);
        assert_eq!(extract_timestamp_suffix("session_2026_abcdef"), None);
        assert_eq!(extract_timestamp_suffix("short"), None);
    }

    #[test]
    fn sanitize_stem_strips_unsafe_characters() {
        assert_eq!(sanitize_stem("kick/drum!hat"), "kick-drum-hat");
        assert_eq!(sanitize_stem("__valid-name__"), "valid-name");
        assert_eq!(sanitize_stem("///"), "recording");
        assert_eq!(sanitize_stem("dark-kick"), "dark-kick");
        assert_eq!(sanitize_stem("a kick drum"), "a-kick-drum");
    }

    #[test]
    fn rename_preserves_timestamp_suffix() {
        let tmp = tempfile::tempdir().unwrap();
        let original = tmp.path().join("session_20260415_183012.wav");
        std::fs::write(&original, b"fake wav").unwrap();
        let new_path = rename_with_stem(original.to_str().unwrap(), "dark-kick");
        assert!(new_path.ends_with("dark-kick_20260415_183012.wav"));
        assert!(std::path::Path::new(&new_path).exists());
        assert!(!original.exists());
    }

    #[test]
    fn rename_keeps_original_path_if_target_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let original = tmp.path().join("session_20260415_183012.wav");
        std::fs::write(&original, b"fake wav").unwrap();
        let conflict = tmp.path().join("dark-kick_20260415_183012.wav");
        std::fs::write(&conflict, b"other").unwrap();

        let new_path = rename_with_stem(original.to_str().unwrap(), "dark-kick");
        assert_eq!(new_path, original.to_str().unwrap());
        assert!(original.exists(), "original should not have been renamed");
    }

    #[test]
    fn build_sidecar_request_with_bpm_and_key() {
        let req = build_sidecar_request(7, "/tmp/x.wav", Some(128.0), Some("Am"));
        assert!(req.contains("\"method\":\"name_recording\""));
        assert!(req.contains("\"path\":\"/tmp/x.wav\""));
        assert!(req.contains("\"bpm\":128"));
        assert!(req.contains("\"key\":\"Am\""));
        assert!(req.contains("\"id\":7"));
    }

    #[test]
    fn build_sidecar_request_omits_missing_fields() {
        let req = build_sidecar_request(1, "/tmp/x.wav", None, None);
        assert!(!req.contains("bpm"));
        assert!(!req.contains("key"));
    }

    #[test]
    fn parse_sidecar_response_happy_path() {
        let resp = r#"{"jsonrpc":"2.0","result":{"stem":"dark-kick_128bpm_Am","tags":["kick"],"method":"clap"},"id":1}"#;
        let parsed = parse_sidecar_response(resp).expect("should parse");
        assert_eq!(parsed.0, "dark-kick_128bpm_Am");
        assert_eq!(parsed.1, vec!["kick".to_string()]);
        assert_eq!(parsed.2, "clap");
    }

    #[test]
    fn parse_sidecar_response_errors_return_none() {
        assert!(parse_sidecar_response("not json").is_none());
        assert!(parse_sidecar_response(r#"{"error":{"code":-1}}"#).is_none());
    }

    #[test]
    fn fallback_rename_generates_deterministic_name() {
        let tmp = tempfile::tempdir().unwrap();
        let original = tmp.path().join("session_20260415_183012.wav");
        std::fs::write(&original, b"x").unwrap();
        let result = fallback_rename(original.to_str().unwrap());
        assert_eq!(result.method, "heroku-fallback");
        assert!(!result.stem.is_empty());
        assert!(result.new_path.ends_with("_20260415_183012.wav"));
    }
}
