//! Orphaned-recording scanner.
//!
//! Scans a recordings directory for WAV files whose absolute path is absent
//! from the `samples` table, classifies each as `Valid` or `Invalid`, and
//! returns the list to the caller.
//!
//! - **Valid**: `hound::WavReader::open` succeeds — can be imported or deleted.
//! - **Invalid**: file smaller than a RIFF header (< 44 bytes) OR hound returns
//!   an error — offer Delete only, never Import (import would fail anyway).

use crate::db::Database;
use crate::error::Result;
use std::collections::HashSet;
use std::path::Path;

/// Minimum valid WAV size — the RIFF/WAV header alone is 44 bytes.
const WAV_HEADER_MIN_BYTES: u64 = 44;

/// Whether an orphan can be imported.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrphanKind {
    /// Parseable WAV — offer Import or Delete.
    Valid,
    /// Too small or unparseable — offer Delete only.
    Invalid,
}

/// A WAV file found on disk that has no corresponding row in `samples`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct OrphanedRecording {
    pub path: String,
    pub kind: OrphanKind,
    pub size_bytes: u64,
}

/// Classify a single file path as Valid or Invalid and return its size.
fn classify(path: &Path) -> (OrphanKind, u64) {
    let size = path.metadata().map(|m| m.len()).unwrap_or(0);
    let kind = if size < WAV_HEADER_MIN_BYTES || hound::WavReader::open(path).is_err() {
        OrphanKind::Invalid
    } else {
        OrphanKind::Valid
    };
    (kind, size)
}

/// Recursively scan `dir` for `.wav` files (case-insensitive extension) that
/// are absent from `known_paths`, and append them to `results`.
pub fn scan_dir_recursive(
    dir: &Path,
    known_paths: &HashSet<String>,
    results: &mut Vec<OrphanedRecording>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_dir_recursive(&path, known_paths, results);
        } else if path
            .extension()
            .map(|e| e.to_ascii_lowercase() == "wav")
            .unwrap_or(false)
        {
            let abs = path.to_string_lossy().to_string();
            if !known_paths.contains(&abs) {
                let (kind, size_bytes) = classify(&path);
                results.push(OrphanedRecording { path: abs, kind, size_bytes });
            }
        }
    }
}

/// Scan `recordings_dir` and return every WAV file not in `db.samples.path`.
///
/// Returns an empty list if `recordings_dir` does not exist.
pub fn scan_orphans(db: &Database, recordings_dir: &Path) -> Result<Vec<OrphanedRecording>> {
    let known = db.get_all_sample_paths()?;

    if !recordings_dir.exists() {
        return Ok(Vec::new());
    }

    let mut orphans = Vec::new();
    scan_dir_recursive(recordings_dir, &known, &mut orphans);
    Ok(orphans)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn write_bytes(dir: &Path, name: &str, data: &[u8]) -> std::path::PathBuf {
        let p = dir.join(name);
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(data).unwrap();
        p
    }

    fn write_valid_wav(dir: &Path, name: &str) -> std::path::PathBuf {
        let p = dir.join(name);
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 44100,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&p, spec).unwrap();
        for _ in 0..44100 {
            writer.write_sample(0i16).unwrap();
        }
        writer.finalize().unwrap();
        p
    }

    /// Acceptance-test: exactly three of the four files are surfaced; the
    /// known-good clip already in `samples` must be excluded.
    ///
    /// Heuristic verification:
    /// - 30-byte file  → Invalid (below WAV_HEADER_MIN_BYTES)
    /// - 100-byte file with garbage content → Invalid (hound fails)
    /// - valid 1-second WAV → Valid (import offered)
    /// - valid WAV in `known` → not returned at all
    #[test]
    fn test_orphan_detection_heuristic() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        let _tiny = write_bytes(dir, "tiny.wav", &[0u8; 30]);
        let _malformed = write_bytes(dir, "malformed.wav", &[0xFFu8; 100]);
        let _valid = write_valid_wav(dir, "valid.wav");
        let known_good = write_valid_wav(dir, "known_good.wav");

        let mut known: HashSet<String> = HashSet::new();
        known.insert(known_good.to_string_lossy().to_string());

        let mut orphans = Vec::new();
        scan_dir_recursive(dir, &known, &mut orphans);

        assert_eq!(
            orphans.len(),
            3,
            "expected 3 orphans, got {:?}",
            orphans.iter().map(|o| &o.path).collect::<Vec<_>>()
        );

        let by_name: std::collections::HashMap<_, _> = orphans
            .iter()
            .map(|o| {
                let name = Path::new(&o.path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string();
                (name, o)
            })
            .collect();

        assert_eq!(by_name["tiny.wav"].kind, OrphanKind::Invalid, "30-byte file must be Invalid");
        assert_eq!(by_name["malformed.wav"].kind, OrphanKind::Invalid, "garbage WAV must be Invalid");
        assert_eq!(by_name["valid.wav"].kind, OrphanKind::Valid, "valid WAV must be Valid");
    }

    #[test]
    fn test_non_wav_files_ignored() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        write_bytes(dir, "note.txt", b"hello");
        write_bytes(dir, "audio.mp3", &[0u8; 100]);
        write_valid_wav(dir, "clip.wav");

        let known: HashSet<String> = HashSet::new();
        let mut orphans = Vec::new();
        scan_dir_recursive(dir, &known, &mut orphans);

        assert_eq!(orphans.len(), 1);
        assert!(orphans[0].path.ends_with("clip.wav"));
    }

    #[test]
    fn test_empty_dir_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let known: HashSet<String> = HashSet::new();
        let mut orphans = Vec::new();
        scan_dir_recursive(tmp.path(), &known, &mut orphans);
        assert!(orphans.is_empty());
    }

    #[test]
    fn test_nonexistent_dir_returns_empty() {
        let known: HashSet<String> = HashSet::new();
        let mut orphans = Vec::new();
        scan_dir_recursive(Path::new("/nonexistent/path/recordings"), &known, &mut orphans);
        assert!(orphans.is_empty());
    }

    #[test]
    fn test_skip_is_stateless_rescan_resurfaces() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        write_valid_wav(dir, "forgotten.wav");

        let known: HashSet<String> = HashSet::new();

        // First scan: surfaced
        let mut first = Vec::new();
        scan_dir_recursive(dir, &known, &mut first);
        assert_eq!(first.len(), 1);

        // "Skip" = do nothing (no state written).  Second scan resurfaces it.
        let mut second = Vec::new();
        scan_dir_recursive(dir, &known, &mut second);
        assert_eq!(second.len(), 1, "file must resurface on next scan (stateless)");
    }
}
