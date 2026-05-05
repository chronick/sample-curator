//! Shared helpers for sample-in → sample-out transforms.
//!
//! `split` (vault-3fe9) is the first concrete transform; `stem`
//! separation (vault-2nnt) and future transforms (pitch shift, time
//! stretch, format convert, …) repeat the same parent-inheritance
//! pattern. Rather than copy-pasting the tag-snapshot + apply block
//! into each transform module, they share `ParentInheritance` here.
//!
//! See vault-22o9 (planned) for the bigger story — a unified
//! `TransformJob` trait + queue that this helper is the seed of.
//! Until two real callers land (split + stems), we only extract the
//! one obviously-shared piece.

use sample_library_core::db::Database;

/// Snapshot of the inheritance-relevant tags on a parent sample.
///
/// Take the snapshot **once** before the transform's per-output loop:
/// reading the parent's tags inside the loop is wasteful and risks
/// inconsistency if some other code path mutates them mid-transform.
pub struct ParentInheritance {
    pub parent_id: i64,
    /// `Some("session:<UUID>")` when the parent has one. Subs of an
    /// un-armed manual recording get `None` — correct, not a bug.
    pub session_tag: Option<String>,
}

impl ParentInheritance {
    /// Read the parent's tags and stash any inheritance candidates.
    pub fn snapshot(db: &Database, parent_id: i64) -> Result<Self, String> {
        let tags = db
            .get_sample_tags(parent_id)
            .map_err(|e| format!("Failed to read parent tags: {}", e))?;
        let session_tag = tags
            .iter()
            .find(|t| t.name.starts_with("session:"))
            .map(|t| t.name.clone());
        Ok(Self {
            parent_id,
            session_tag,
        })
    }

    /// Apply inheritance + caller-supplied extras to a freshly-inserted
    /// output sample.
    ///
    /// What this does in order:
    /// 1. `parent:<id>` — links every output to its source for
    ///    click-through from the detail panel
    /// 2. `session:<UUID>` — copied from the parent if present, so
    ///    stems/chunks slot into the same Sessions browse view
    /// 3. each tag in `extra_tags` — transform-specific labels
    ///    (e.g. `recorded` for split chunks, `stem:drums` for stems)
    ///
    /// Tag-write failures are logged via `eprintln!` but not returned.
    /// A row is in the DB at this point; a missing tag is recoverable
    /// (re-run inheritance manually, or from a future repair tool).
    /// Aborting the whole transform on a single tag write would lose
    /// already-completed output rows for sibling chunks/stems.
    pub fn apply(
        &self,
        db: &Database,
        new_sample_id: i64,
        extra_tags: &[&str],
    ) {
        if let Err(e) = db.add_tag_to_sample(new_sample_id, &format!("parent:{}", self.parent_id)) {
            eprintln!(
                "[transforms] failed to apply parent:{} on sample {}: {}",
                self.parent_id, new_sample_id, e
            );
        }
        if let Some(ref tag) = self.session_tag {
            if let Err(e) = db.add_tag_to_sample(new_sample_id, tag) {
                eprintln!(
                    "[transforms] failed to apply {} on sample {}: {}",
                    tag, new_sample_id, e
                );
            }
        }
        for tag in extra_tags {
            if let Err(e) = db.add_tag_to_sample(new_sample_id, tag) {
                eprintln!(
                    "[transforms] failed to apply {} on sample {}: {}",
                    tag, new_sample_id, e
                );
            }
        }
    }
}
