fn main() {
    tauri_build::build();

    // Apple Foundation Models bridge (vault-3ume): compile + link the
    // Swift package at `swift/sample_curator_fm/`. macOS-only — on other
    // platforms we don't link anything and `foundation_models.rs` provides
    // a stub implementation.
    #[cfg(target_os = "macos")]
    {
        use swift_rs::SwiftLinker;
        SwiftLinker::new("15.0")
            .with_package("SampleCuratorFM", "swift/sample_curator_fm/")
            .link();
        // Ensure Cargo re-runs the linker when the Swift sources change.
        println!("cargo:rerun-if-changed=swift/sample_curator_fm/Package.swift");
        println!(
            "cargo:rerun-if-changed=swift/sample_curator_fm/Sources/SampleCuratorFM/SampleCuratorFM.swift"
        );
    }
}
