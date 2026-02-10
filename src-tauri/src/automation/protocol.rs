use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct AutomationRequest {
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct AutomationResponse {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AutomationError>,
}

#[derive(Debug, Serialize)]
pub struct AutomationError {
    pub code: String,
    pub message: String,
}

impl AutomationResponse {
    pub fn success(id: String, result: serde_json::Value) -> Self {
        Self {
            id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(id: String, code: &str, message: String) -> Self {
        Self {
            id,
            ok: false,
            result: None,
            error: Some(AutomationError {
                code: code.to_string(),
                message,
            }),
        }
    }
}
