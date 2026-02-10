use base64::Engine;
use std::process::Command;

/// Capture a screenshot of the application window on macOS.
/// Returns base64-encoded PNG data along with dimensions.
pub fn capture_window(app_name: &str) -> Result<serde_json::Value, String> {
    // Sanitize app_name: only allow alphanumeric, hyphens, underscores, spaces, dots
    if !app_name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c == '.')
    {
        return Err("Invalid app_name: only alphanumeric, hyphens, underscores, spaces, and dots allowed".to_string());
    }

    if app_name.is_empty() || app_name.len() > 100 {
        return Err("Invalid app_name: must be 1-100 characters".to_string());
    }

    // Step 1: Find the window ID using swift + CGWindowListCopyWindowInfo
    // Pass app_name via env var to avoid injection (already sanitized above)
    let swift_script = r#"
import Cocoa
let targetName = ProcessInfo.processInfo.environment["AUTOMATION_WINDOW_NAME"] ?? "sample-curator"
let windowList = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
for window in windowList {
    if let owner = window[kCGWindowOwnerName as String] as? String,
       owner == targetName,
       let windowId = window[kCGWindowNumber as String] as? Int {
        print(windowId)
        exit(0)
    }
}
// Fallback: try matching partial name
for window in windowList {
    if let owner = window[kCGWindowOwnerName as String] as? String,
       owner.contains(targetName),
       let windowId = window[kCGWindowNumber as String] as? Int {
        print(windowId)
        exit(0)
    }
}
fputs("Window not found", stderr)
exit(1)
"#;

    let window_id_output = Command::new("swift")
        .arg("-e")
        .arg(swift_script)
        .env("AUTOMATION_WINDOW_NAME", app_name)
        .output()
        .map_err(|e| format!("Failed to run swift: {}", e))?;

    if !window_id_output.status.success() {
        let stderr = String::from_utf8_lossy(&window_id_output.stderr);
        return Err(format!("Failed to find window: {}", stderr.trim()));
    }

    let window_id = String::from_utf8_lossy(&window_id_output.stdout)
        .trim()
        .to_string();

    if window_id.is_empty() {
        return Err("Could not determine window ID".to_string());
    }

    // Validate window_id is numeric
    if !window_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid window ID returned".to_string());
    }

    // Step 2: Capture the window using screencapture
    let tmp_path = format!(
        "{}/sample-curator-screenshot-{}.png",
        std::env::temp_dir().to_string_lossy(),
        uuid::Uuid::new_v4()
    );

    let capture_output = Command::new("screencapture")
        .args(["-l", &window_id, "-o", "-x", &tmp_path])
        .output()
        .map_err(|e| format!("Failed to run screencapture: {}", e))?;

    if !capture_output.status.success() {
        let _ = std::fs::remove_file(&tmp_path);
        let stderr = String::from_utf8_lossy(&capture_output.stderr);
        return Err(format!("screencapture failed: {}", stderr.trim()));
    }

    // Step 3: Read the file and encode as base64
    let png_data = match std::fs::read(&tmp_path) {
        Ok(data) => {
            let _ = std::fs::remove_file(&tmp_path);
            data
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(format!("Failed to read screenshot: {}", e));
        }
    };

    // Step 4: Parse PNG header for dimensions
    let (width, height) = parse_png_dimensions(&png_data)?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_data);

    Ok(serde_json::json!({
        "data": b64,
        "width": width,
        "height": height,
        "format": "png"
    }))
}

/// Parse width and height from PNG IHDR chunk.
fn parse_png_dimensions(data: &[u8]) -> Result<(u32, u32), String> {
    // PNG signature (8 bytes) + IHDR length (4 bytes) + "IHDR" (4 bytes) + width (4) + height (4)
    if data.len() < 24 {
        return Err("PNG data too small".to_string());
    }

    // Verify PNG signature
    if &data[0..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("Not a valid PNG file".to_string());
    }

    // IHDR chunk starts at offset 8
    // Length: bytes 8-11, Type: bytes 12-15 ("IHDR"), Width: bytes 16-19, Height: bytes 20-23
    let width = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
    let height = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);

    Ok((width, height))
}
