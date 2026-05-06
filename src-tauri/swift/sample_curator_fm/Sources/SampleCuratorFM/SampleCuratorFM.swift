// Apple Foundation Models bridge for sample-curator (vault-3ume).
//
// Three entry points exposed to Rust via `@_cdecl`:
//
// - `sc_fm_available()` -> `Bool` — true iff the on-device language model
//   is available right now (macOS 26.0+, Apple Silicon, Apple Intelligence
//   enabled, model downloaded).
// - `sc_fm_unavailable_reason()` -> `SRString` — empty string when
//   available; otherwise a one-line user-facing reason.
// - `sc_fm_refine(prompt)` -> `SRString` — synchronously runs the prompt
//   through `LanguageModelSession` and returns the response. Empty string
//   on any failure (caller treats it as "skip").
//
// Async-to-sync bridging uses a `DispatchSemaphore` because the Rust side
// is called from a blocking Tauri command. Acceptable here: the LLM call
// is short (single-shot, ~24 tokens) and we already block the calling
// thread today for the ollama path.
//
// FoundationModels.LanguageModelSession was introduced in macOS 26.0 — all
// real work is gated by `#available(macOS 26.0, *)`. On older systems the
// stubs return false / empty so the Rust side falls back gracefully.

import Foundation
import SwiftRs

#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - Availability

@_cdecl("sc_fm_available")
public func sc_fm_available() -> Bool {
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
            return true
        default:
            return false
        }
    }
    #endif
    return false
}

@_cdecl("sc_fm_unavailable_reason")
public func sc_fm_unavailable_reason() -> SRString {
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
            return SRString("")
        case .unavailable(.deviceNotEligible):
            return SRString("Device is not eligible for Apple Intelligence (requires Apple Silicon).")
        case .unavailable(.appleIntelligenceNotEnabled):
            return SRString("Apple Intelligence is not enabled — turn it on in System Settings → Apple Intelligence.")
        case .unavailable(.modelNotReady):
            return SRString("Foundation Models is downloading — try again in a few minutes.")
        case .unavailable(let reason):
            return SRString("Foundation Models unavailable: \(reason)")
        }
    } else {
        return SRString("Requires macOS 26.0 or later.")
    }
    #else
    return SRString("FoundationModels framework is not available on this platform.")
    #endif
}

// MARK: - Refinement

@_cdecl("sc_fm_refine")
public func sc_fm_refine(prompt: SRString) -> SRString {
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        let promptStr = prompt.toString()
        if promptStr.isEmpty {
            return SRString("")
        }

        // Async-to-sync via semaphore. The LanguageModelSession.respond(to:)
        // call is async; we wrap it in a Task and block the current (Rust)
        // thread until it returns.
        let semaphore = DispatchSemaphore(value: 0)
        let resultBox = ResultBox()

        Task {
            defer { semaphore.signal() }
            do {
                let session = LanguageModelSession()
                let response = try await session.respond(to: promptStr)
                resultBox.value = response.content
            } catch {
                NSLog("sc_fm_refine error: \(error)")
                resultBox.value = ""
            }
        }

        semaphore.wait()
        return SRString(resultBox.value)
    }
    #endif
    return SRString("")
}

// Sendable wrapper so the Task closure captures don't trigger Swift 6
// concurrency warnings. The semaphore enforces the happens-before edge.
private final class ResultBox: @unchecked Sendable {
    var value: String = ""
}
