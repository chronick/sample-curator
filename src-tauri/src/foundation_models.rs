//! Apple Foundation Models bridge (vault-3ume).
//!
//! On macOS this calls into the Swift package at `swift/sample_curator_fm/`
//! via `swift-rs`. On non-macOS the `available()` probe returns false and
//! `refine()` returns `None` — the rest of the LLM dispatch path quietly
//! falls back to the mechanical stem.
//!
//! All entry points are intentionally synchronous + blocking. The Swift
//! side bridges async-to-sync via a `DispatchSemaphore`; we don't wrap in
//! tokio because the call is short-lived (single-shot, ~24 tokens) and
//! happens inside a Tauri command thread.

#[cfg(target_os = "macos")]
mod imp {
    use swift_rs::{swift, SRString};

    swift!(fn sc_fm_available() -> bool);
    swift!(fn sc_fm_unavailable_reason() -> SRString);
    swift!(fn sc_fm_refine(prompt: SRString) -> SRString);

    pub fn available() -> bool {
        unsafe { sc_fm_available() }
    }

    pub fn unavailable_reason() -> Option<String> {
        let s = unsafe { sc_fm_unavailable_reason() };
        let s = s.to_string();
        if s.is_empty() { None } else { Some(s) }
    }

    pub fn refine(prompt: &str) -> Option<String> {
        let result = unsafe { sc_fm_refine(SRString::from(prompt)) };
        let result = result.to_string();
        if result.is_empty() { None } else { Some(result) }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn available() -> bool {
        false
    }

    pub fn unavailable_reason() -> Option<String> {
        Some("Apple Foundation Models is only available on macOS.".to_string())
    }

    pub fn refine(_prompt: &str) -> Option<String> {
        None
    }
}

pub fn available() -> bool {
    imp::available()
}

pub fn unavailable_reason() -> Option<String> {
    imp::unavailable_reason()
}

pub fn refine(prompt: &str) -> Option<String> {
    imp::refine(prompt)
}

// ============ Tauri commands ============

/// Refine a transcript via Apple Foundation Models. Returns the model's
/// output verbatim — caller is responsible for sanitizing into a filename
/// stem (same path as the ollama / hf backends).
///
/// Returns ``Ok(None)`` when FM is unavailable or the call fails — caller
/// treats both as "skip refinement, use mechanical stem".
#[tauri::command]
pub fn llm_foundation_refine(prompt: String) -> Result<Option<String>, String> {
    if !available() {
        return Ok(None);
    }
    Ok(refine(&prompt))
}

/// Surface FM availability to the frontend. Used by the ML features tab to
/// disable the "Apple Foundation Models" backend selector entry with a
/// specific reason when prerequisites aren't met.
#[tauri::command]
pub fn llm_foundation_availability() -> serde_json::Value {
    serde_json::json!({
        "available": available(),
        "unavailable_reason": unavailable_reason(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "calls the real FoundationModels framework — requires macOS 26+ + Apple Intelligence. Run with --ignored to exercise."]
    fn refine_real_call() {
        if !available() {
            eprintln!("FM not available — skipping real call");
            return;
        }
        let prompt = "You are naming a vocal sample. Transcript: \"we ride the eternal wave\". Produce a 2-4 word lowercase hyphenated filename stem (no quotes, no explanation):";
        let result = refine(prompt);
        eprintln!("FM refine result: {:?}", result);
        // We don't assert content (model output varies) — just that
        // we got *something* back.
        assert!(result.is_some(), "FM refine returned None on a working system");
    }

    #[test]
    fn availability_probe_does_not_crash() {
        // We can't assert true/false — depends on the host system. Just
        // confirm the FFI round-trip doesn't panic and returns
        // a self-consistent answer (available => no reason).
        let avail = available();
        let reason = unavailable_reason();
        eprintln!("FM availability: {avail}, reason: {:?}", reason);
        if avail {
            assert!(reason.is_none(), "available=true but reason={:?}", reason);
        } else {
            assert!(reason.is_some(), "available=false but no reason given");
        }
    }
}
