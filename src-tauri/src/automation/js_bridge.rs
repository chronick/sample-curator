use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Listener, Manager};
use tokio::sync::oneshot;

/// Shared registry for pending JS eval requests.
/// Maps correlation ID -> oneshot sender for the result.
/// Uses std::sync::Mutex (not tokio) since the lock is only held briefly
/// and the Tauri event listener callback is synchronous.
pub struct JsBridge {
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<serde_json::Value, String>>>>>,
}

impl JsBridge {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start listening for eval results from the webview.
    /// Call this once during setup.
    pub fn listen(&self, app: &AppHandle) {
        let pending = self.pending.clone();

        // Listen for results emitted by the JS wrapper
        app.listen("automation:eval-result", move |event| {
            let payload = event.payload();
            if let Ok(result) = serde_json::from_str::<serde_json::Value>(payload) {
                let id = result.get("id").and_then(|v| v.as_str()).unwrap_or("");

                let mut map = match pending.lock() {
                    Ok(m) => m,
                    Err(_) => return,
                };

                if let Some(sender) = map.remove(id) {
                    if let Some(error) = result.get("error") {
                        let _ = sender.send(Err(
                            error.as_str().unwrap_or("Unknown JS error").to_string(),
                        ));
                    } else {
                        let value = result
                            .get("value")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        let _ = sender.send(Ok(value));
                    }
                }
            }
        });
    }

    /// Evaluate JavaScript in the webview and wait for the result.
    /// The script should be an expression or use `return` (it's wrapped in an async IIFE).
    pub async fn eval(
        &self,
        app: &AppHandle,
        script: &str,
        timeout_secs: u64,
    ) -> Result<serde_json::Value, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();

        // Register the pending request
        {
            let mut map = self.pending.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
            map.insert(id.clone(), tx);
        }

        // Wrap the script in an async IIFE that emits the result back.
        // In Tauri v2 (without withGlobalTauri), emit is:
        //   window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event, payload })
        let wrapped = format!(
            r#"(async function() {{
    const __id = {id_json};
    const __emit = async (evt, payload) => {{
        if (window.__TAURI_INTERNALS__?.invoke) {{
            await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{ event: evt, payload }});
        }}
    }};
    try {{
        const __result = await (async function() {{ {script} }})();
        await __emit('automation:eval-result', {{
            id: __id,
            value: __result === undefined ? null : __result
        }});
    }} catch (e) {{
        await __emit('automation:eval-result', {{
            id: __id,
            error: e.message || String(e)
        }});
    }}
}})()"#,
            id_json = serde_json::to_string(&id).unwrap(),
            script = script
        );

        // Execute in webview
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "Main window not found".to_string())?;

        window
            .eval(&wrapped)
            .map_err(|e| format!("Failed to eval JS: {}", e))?;

        // Wait for result with timeout
        match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("JS eval channel closed unexpectedly".to_string()),
            Err(_) => {
                // Clean up the pending entry
                if let Ok(mut map) = self.pending.lock() {
                    map.remove(&id);
                }
                Err(format!("JS eval timed out after {}s", timeout_secs))
            }
        }
    }
}
