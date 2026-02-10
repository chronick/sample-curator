use super::handlers::{handle_message, HandlerContext};
use super::js_bridge::JsBridge;
use super::protocol::AutomationRequest;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Instant;
use tauri::AppHandle;
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;

pub async fn run(
    app: AppHandle,
    js_bridge: Arc<JsBridge>,
    console_tx: broadcast::Sender<String>,
) {
    let port = std::env::var("AUTOMATION_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(9514);

    let addr = format!("127.0.0.1:{}", port);

    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[automation] Failed to bind to {}: {}", addr, e);
            return;
        }
    };

    let actual_port = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    eprintln!(
        "[automation] WebSocket server listening on ws://127.0.0.1:{}",
        actual_port
    );

    // Write port file for service discovery
    write_port_file(actual_port);

    let auth_token = std::env::var("AUTOMATION_TOKEN").ok();
    let start_time = Instant::now();

    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                eprintln!("[automation] Accept error: {}", e);
                continue;
            }
        };

        eprintln!("[automation] New connection from {}", peer);

        let app_clone = app.clone();
        let js_bridge_clone = js_bridge.clone();
        let auth_token_clone = auth_token.clone();
        let console_rx = console_tx.subscribe();

        tokio::spawn(async move {
            let ws_stream = match tokio_tungstenite::accept_async(stream).await {
                Ok(ws) => ws,
                Err(e) => {
                    eprintln!("[automation] WebSocket handshake error: {}", e);
                    return;
                }
            };

            handle_connection(
                ws_stream,
                app_clone,
                js_bridge_clone,
                auth_token_clone,
                start_time,
                console_rx,
                peer,
            )
            .await;

            eprintln!("[automation] Connection from {} closed", peer);
        });
    }
}

async fn handle_connection(
    ws_stream: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    app: AppHandle,
    js_bridge: Arc<JsBridge>,
    auth_token: Option<String>,
    start_time: Instant,
    mut console_rx: broadcast::Receiver<String>,
    peer: std::net::SocketAddr,
) {
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let mut authenticated = auth_token.is_none();
    let mut console_subscribed = false;

    let ctx = HandlerContext {
        app,
        js_bridge,
        start_time,
    };

    // Main loop: select between incoming WS messages and console broadcast
    loop {
        tokio::select! {
            // Incoming WebSocket message
            ws_msg = ws_receiver.next() => {
                let msg = match ws_msg {
                    Some(Ok(m)) => m,
                    Some(Err(e)) => {
                        eprintln!("[automation] Read error from {}: {}", peer, e);
                        break;
                    }
                    None => break,
                };

                let text = match msg {
                    Message::Text(t) => t,
                    Message::Close(_) => break,
                    Message::Ping(data) => {
                        let _ = ws_sender.send(Message::Pong(data)).await;
                        continue;
                    }
                    _ => continue,
                };

                // Handle authentication if required
                if !authenticated {
                    match handle_auth(&text, auth_token.as_deref()) {
                        AuthResult::Authenticated => {
                            authenticated = true;
                            let resp = serde_json::json!({
                                "id": "auth",
                                "ok": true,
                                "result": { "authenticated": true }
                            });
                            let _ = ws_sender
                                .send(Message::Text(serde_json::to_string(&resp).unwrap().into()))
                                .await;
                            continue;
                        }
                        AuthResult::Failed(msg) => {
                            let resp = serde_json::json!({
                                "id": "auth",
                                "ok": false,
                                "error": { "code": "AUTH_FAILED", "message": msg }
                            });
                            let _ = ws_sender
                                .send(Message::Text(serde_json::to_string(&resp).unwrap().into()))
                                .await;
                            break;
                        }
                        AuthResult::NotAuthMessage => {
                            let resp = serde_json::json!({
                                "id": "unknown",
                                "ok": false,
                                "error": { "code": "AUTH_REQUIRED", "message": "First message must be auth" }
                            });
                            let _ = ws_sender
                                .send(Message::Text(serde_json::to_string(&resp).unwrap().into()))
                                .await;
                            break;
                        }
                    }
                }

                // Parse request
                let req: AutomationRequest = match serde_json::from_str(&text) {
                    Ok(r) => r,
                    Err(e) => {
                        let resp = serde_json::json!({
                            "id": "unknown",
                            "ok": false,
                            "error": { "code": "PARSE_ERROR", "message": format!("Invalid JSON: {}", e) }
                        });
                        let _ = ws_sender
                            .send(Message::Text(serde_json::to_string(&resp).unwrap().into()))
                            .await;
                        continue;
                    }
                };

                // Handle subscribe/unsubscribe locally (they control per-connection state)
                match req.method.as_str() {
                    "subscribe_console" => {
                        console_subscribed = true;
                        let resp = serde_json::json!({
                            "id": req.id,
                            "ok": true,
                            "result": { "subscribed": true }
                        });
                        let _ = ws_sender
                            .send(Message::Text(serde_json::to_string(&resp).unwrap().into()))
                            .await;
                        continue;
                    }
                    "unsubscribe_console" => {
                        console_subscribed = false;
                        let resp = serde_json::json!({
                            "id": req.id,
                            "ok": true,
                            "result": { "subscribed": false }
                        });
                        let _ = ws_sender
                            .send(Message::Text(serde_json::to_string(&resp).unwrap().into()))
                            .await;
                        continue;
                    }
                    _ => {}
                }

                // Dispatch to handler
                let response = handle_message(&ctx, req).await;
                let response_json = serde_json::to_string(&response).unwrap_or_else(|_| {
                    r#"{"id":"?","ok":false,"error":{"code":"SERIALIZE_ERROR","message":"Failed to serialize response"}}"#.to_string()
                });

                if ws_sender.send(Message::Text(response_json.into())).await.is_err() {
                    break;
                }
            }

            // Console broadcast message (only forwarded if subscribed)
            console_msg = console_rx.recv(), if console_subscribed => {
                match console_msg {
                    Ok(msg) => {
                        if ws_sender.send(Message::Text(msg.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        // Notify client they missed messages
                        let warning = serde_json::json!({
                            "id": "_push",
                            "method": "console_lagged",
                            "params": { "missed": n }
                        });
                        let _ = ws_sender
                            .send(Message::Text(serde_json::to_string(&warning).unwrap().into()))
                            .await;
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        // Channel closed, stop streaming
                        console_subscribed = false;
                    }
                }
            }
        }
    }
}

enum AuthResult {
    Authenticated,
    Failed(String),
    NotAuthMessage,
}

fn handle_auth(text: &str, expected_token: Option<&str>) -> AuthResult {
    let expected = match expected_token {
        Some(t) => t,
        None => return AuthResult::Authenticated,
    };

    let parsed: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return AuthResult::NotAuthMessage,
    };

    if parsed.get("method").and_then(|m| m.as_str()) != Some("auth") {
        return AuthResult::NotAuthMessage;
    }

    let token = parsed
        .get("params")
        .and_then(|p| p.get("token"))
        .and_then(|t| t.as_str())
        .unwrap_or("");

    if token == expected {
        AuthResult::Authenticated
    } else {
        AuthResult::Failed("Invalid token".to_string())
    }
}

fn write_port_file(port: u16) {
    let tmp_dir = std::env::temp_dir();
    let port_file = tmp_dir.join("sample-curator-automation.port");
    match std::fs::write(&port_file, port.to_string()) {
        Ok(_) => eprintln!("[automation] Port file written to {:?}", port_file),
        Err(e) => eprintln!("[automation] Failed to write port file: {}", e),
    }
}
