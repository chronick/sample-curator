use super::js_bridge::JsBridge;
use super::protocol::{AutomationRequest, AutomationResponse};
use super::screenshot;
use std::sync::Arc;
use std::time::Instant;
use tauri::AppHandle;

pub struct HandlerContext {
    pub app: AppHandle,
    pub js_bridge: Arc<JsBridge>,
    pub start_time: Instant,
}

pub async fn handle_message(
    ctx: &HandlerContext,
    req: AutomationRequest,
) -> AutomationResponse {
    match req.method.as_str() {
        "ping" => handle_ping(ctx, req),
        "eval_js" => handle_eval_js(ctx, req).await,
        "screenshot" => handle_screenshot(ctx, req),
        "invoke" => handle_invoke(ctx, req).await,
        "query_state" => handle_query_state(ctx, req).await,
        "dom_query" => handle_dom_query(ctx, req).await,
        "dom_query_all" => handle_dom_query_all(ctx, req).await,
        "dom_click" => handle_dom_click(ctx, req).await,
        "dom_type" => handle_dom_type(ctx, req).await,
        "dom_scroll" => handle_dom_scroll(ctx, req).await,
        "get_console" => handle_get_console(ctx, req).await,
        "clear_console" => handle_clear_console(ctx, req).await,
        _ => AutomationResponse::error(
            req.id,
            "UNKNOWN_METHOD",
            format!("Unknown method: {}", req.method),
        ),
    }
}

fn handle_ping(ctx: &HandlerContext, req: AutomationRequest) -> AutomationResponse {
    let uptime = ctx.start_time.elapsed().as_secs_f64();
    AutomationResponse::success(
        req.id,
        serde_json::json!({
            "pong": true,
            "uptime_secs": uptime
        }),
    )
}

async fn handle_eval_js(ctx: &HandlerContext, req: AutomationRequest) -> AutomationResponse {
    let script = match req.params.get("script").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => {
            return AutomationResponse::error(
                req.id,
                "INVALID_PARAMS",
                "Missing 'script' parameter".to_string(),
            )
        }
    };

    let timeout = req
        .params
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(10);

    match ctx.js_bridge.eval(&ctx.app, script, timeout).await {
        Ok(value) => AutomationResponse::success(req.id, serde_json::json!({ "value": value })),
        Err(e) => AutomationResponse::error(req.id, "EVAL_ERROR", e),
    }
}

fn handle_screenshot(_ctx: &HandlerContext, req: AutomationRequest) -> AutomationResponse {
    let app_name = req
        .params
        .get("app_name")
        .and_then(|v| v.as_str())
        .unwrap_or("sample-curator");

    match screenshot::capture_window(app_name) {
        Ok(result) => AutomationResponse::success(req.id, result),
        Err(e) => AutomationResponse::error(req.id, "SCREENSHOT_ERROR", e),
    }
}

async fn handle_invoke(ctx: &HandlerContext, req: AutomationRequest) -> AutomationResponse {
    let command = match req.params.get("command").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => {
            return AutomationResponse::error(
                req.id,
                "INVALID_PARAMS",
                "Missing 'command' parameter".to_string(),
            )
        }
    };

    let args = req
        .params
        .get("args")
        .cloned()
        .unwrap_or(serde_json::json!({}));

    // Build JS to call the Tauri invoke function
    let args_json = serde_json::to_string(&args).unwrap_or_else(|_| "{}".to_string());
    let command_json = serde_json::to_string(command).unwrap_or_else(|_| "\"\"".to_string());

    let script = format!(
        r#"return await window.__TAURI_INTERNALS__.invoke({command}, {args})"#,
        command = command_json,
        args = args_json
    );

    match ctx.js_bridge.eval(&ctx.app, &script, 30).await {
        Ok(value) => AutomationResponse::success(req.id, serde_json::json!({ "value": value })),
        Err(e) => AutomationResponse::error(req.id, "INVOKE_ERROR", e),
    }
}

async fn handle_query_state(ctx: &HandlerContext, req: AutomationRequest) -> AutomationResponse {
    let script = "return window.__STORE_STATE__ || null";

    match ctx.js_bridge.eval(&ctx.app, script, 5).await {
        Ok(value) => AutomationResponse::success(req.id, serde_json::json!({ "state": value })),
        Err(e) => AutomationResponse::error(req.id, "STATE_ERROR", e),
    }
}

async fn handle_dom_query(ctx: &HandlerContext, req: AutomationRequest) -> AutomationResponse {
    let selector = match req.params.get("selector").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => {
            return AutomationResponse::error(
                req.id,
                "INVALID_PARAMS",
                "Missing 'selector' parameter".to_string(),
            )
        }
    };

    let selector_json = serde_json::to_string(selector).unwrap_or_else(|_| "\"\"".to_string());
    let script = format!(
        "return window.__AUTOMATION__.queryElement({selector})",
        selector = selector_json
    );

    match ctx.js_bridge.eval(&ctx.app, &script, 5).await {
        Ok(value) => AutomationResponse::success(req.id, value),
        Err(e) => AutomationResponse::error(req.id, "DOM_ERROR", e),
    }
}

async fn handle_dom_query_all(ctx: &HandlerContext, req: AutomationRequest) -> AutomationResponse {
    let selector = match req.params.get("selector").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => {
            return AutomationResponse::error(
                req.id,
                "INVALID_PARAMS",
                "Missing 'selector' parameter".to_string(),
            )
        }
    };

    let selector_json = serde_json::to_string(selector).unwrap_or_else(|_| "\"\"".to_string());
    let script = format!(
        "return window.__AUTOMATION__.queryAll({selector})",
        selector = selector_json
    );

    match ctx.js_bridge.eval(&ctx.app, &script, 5).await {
        Ok(value) => AutomationResponse::success(req.id, serde_json::json!({ "elements": value })),
        Err(e) => AutomationResponse::error(req.id, "DOM_ERROR", e),
    }
}

async fn handle_dom_click(ctx: &HandlerContext, req: AutomationRequest) -> AutomationResponse {
    let selector = match req.params.get("selector").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => {
            return AutomationResponse::error(
                req.id,
                "INVALID_PARAMS",
                "Missing 'selector' parameter".to_string(),
            )
        }
    };

    let selector_json = serde_json::to_string(selector).unwrap_or_else(|_| "\"\"".to_string());
    let script = format!(
        "return window.__AUTOMATION__.click({selector})",
        selector = selector_json
    );

    match ctx.js_bridge.eval(&ctx.app, &script, 5).await {
        Ok(value) => AutomationResponse::success(req.id, value),
        Err(e) => AutomationResponse::error(req.id, "DOM_ERROR", e),
    }
}

async fn handle_dom_type(ctx: &HandlerContext, req: AutomationRequest) -> AutomationResponse {
    let selector = match req.params.get("selector").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => {
            return AutomationResponse::error(
                req.id,
                "INVALID_PARAMS",
                "Missing 'selector' parameter".to_string(),
            )
        }
    };

    let text = match req.params.get("text").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => {
            return AutomationResponse::error(
                req.id,
                "INVALID_PARAMS",
                "Missing 'text' parameter".to_string(),
            )
        }
    };

    let clear = req
        .params
        .get("clear")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let selector_json = serde_json::to_string(selector).unwrap_or_else(|_| "\"\"".to_string());
    let text_json = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string());
    let script = format!(
        "return window.__AUTOMATION__.type({selector}, {text}, {clear})",
        selector = selector_json,
        text = text_json,
        clear = clear
    );

    match ctx.js_bridge.eval(&ctx.app, &script, 5).await {
        Ok(value) => AutomationResponse::success(req.id, value),
        Err(e) => AutomationResponse::error(req.id, "DOM_ERROR", e),
    }
}

async fn handle_dom_scroll(ctx: &HandlerContext, req: AutomationRequest) -> AutomationResponse {
    let selector = req.params.get("selector").and_then(|v| v.as_str());
    let x = req.params.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let y = req.params.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);

    let selector_arg = match selector {
        Some(s) => serde_json::to_string(s).unwrap_or_else(|_| "null".to_string()),
        None => "null".to_string(),
    };

    let script = format!(
        "return window.__AUTOMATION__.scroll({selector}, {x}, {y})",
        selector = selector_arg,
        x = x,
        y = y
    );

    match ctx.js_bridge.eval(&ctx.app, &script, 5).await {
        Ok(value) => AutomationResponse::success(req.id, value),
        Err(e) => AutomationResponse::error(req.id, "DOM_ERROR", e),
    }
}

async fn handle_get_console(ctx: &HandlerContext, req: AutomationRequest) -> AutomationResponse {
    let since = req.params.get("since").and_then(|v| v.as_u64());
    let clear = req
        .params
        .get("clear")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let since_arg = match since {
        Some(s) => s.to_string(),
        None => "null".to_string(),
    };

    let script = format!(
        "return window.__AUTOMATION__.getConsoleLogs({since}, {clear})",
        since = since_arg,
        clear = clear
    );

    match ctx.js_bridge.eval(&ctx.app, &script, 5).await {
        Ok(value) => AutomationResponse::success(req.id, serde_json::json!({ "entries": value })),
        Err(e) => AutomationResponse::error(req.id, "CONSOLE_ERROR", e),
    }
}

async fn handle_clear_console(ctx: &HandlerContext, req: AutomationRequest) -> AutomationResponse {
    let script = "return window.__AUTOMATION__.clearConsoleLogs()";

    match ctx.js_bridge.eval(&ctx.app, &script, 5).await {
        Ok(value) => AutomationResponse::success(req.id, value),
        Err(e) => AutomationResponse::error(req.id, "CONSOLE_ERROR", e),
    }
}
