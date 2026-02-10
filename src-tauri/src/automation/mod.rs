mod handlers;
mod js_bridge;
mod protocol;
mod screenshot;
mod server;

use js_bridge::JsBridge;
use std::sync::Arc;
use tauri::{AppHandle, Listener, Manager};
use tokio::sync::broadcast;

const HELPERS_JS: &str = include_str!("helpers.js");

/// Start the automation control channel.
/// Spawns the WebSocket server and injects DOM helpers into the webview.
pub fn start(app: AppHandle) {
    let js_bridge = Arc::new(JsBridge::new());

    // Listen for eval results from the webview
    js_bridge.listen(&app);

    // Console broadcast channel — capacity for burst of messages
    let (console_tx, _) = broadcast::channel::<String>(256);

    // Listen for console events from the webview and broadcast to subscribers
    let console_tx_for_listener = console_tx.clone();
    app.listen("automation:console", move |event| {
        let payload = event.payload();
        // Wrap the raw payload into our push message format
        let push_msg = format!(
            r#"{{"id":"_push","method":"console","params":{}}}"#,
            payload
        );
        // Ignore send errors (no subscribers = no problem)
        let _ = console_tx_for_listener.send(push_msg);
    });

    // Inject helpers.js into the webview once it's ready
    let app_for_inject = app.clone();
    let app_for_server = app.clone();
    let js_bridge_for_server = js_bridge.clone();

    tauri::async_runtime::spawn(async move {
        // Give the webview a moment to initialize
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        if let Some(window) = app_for_inject.get_webview_window("main") {
            match window.eval(HELPERS_JS) {
                Ok(_) => eprintln!("[automation] Injected helpers.js into webview"),
                Err(e) => eprintln!("[automation] Failed to inject helpers.js: {}", e),
            }
        } else {
            eprintln!("[automation] Warning: main window not found for helpers.js injection");
        }
    });

    // Also inject on page load (navigation)
    let app_for_nav = app.clone();
    app.listen("tauri://webview-created", move |_event| {
        let app_clone = app_for_nav.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(200));
            if let Some(window) = app_clone.get_webview_window("main") {
                let _ = window.eval(HELPERS_JS);
            }
        });
    });

    // Clean up port file on exit
    app.listen("tauri://exit-requested", |_event| {
        cleanup_port_file();
    });

    // Spawn the WebSocket server
    tauri::async_runtime::spawn(async move {
        server::run(app_for_server, js_bridge_for_server, console_tx).await;
    });

    eprintln!("[automation] Control channel starting...");
}

fn cleanup_port_file() {
    let port_file = std::env::temp_dir().join("sample-curator-automation.port");
    if port_file.exists() {
        let _ = std::fs::remove_file(&port_file);
        eprintln!("[automation] Cleaned up port file");
    }
}
