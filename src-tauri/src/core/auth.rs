use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use super::session_runtime::{with_facade, SessionRuntimeState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthState {
    LoggedIn,
    LoginRequired,
    UnsupportedApiKey,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub state: AuthState,
    pub account_email: Option<String>,
    pub requires_openai_auth: bool,
    pub raw_auth_mode: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthLoginStartResult {
    pub auth_url: String,
    pub login_id: Option<String>,
}

fn auth_status_from_account_payload(payload: &Value) -> AuthStatus {
    let requires_openai_auth = payload
        .get("requiresOpenaiAuth")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let account = payload.get("account");
    let account_kind = account
        .and_then(|value| value.get("type"))
        .and_then(Value::as_str);
    let account_email = account
        .and_then(|value| value.get("email"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let raw_auth_mode = account_kind.map(ToString::to_string);

    match account_kind {
        Some("chatgpt") => AuthStatus {
            state: AuthState::LoggedIn,
            account_email,
            requires_openai_auth,
            raw_auth_mode,
            message: None,
        },
        Some("apikey") => AuthStatus {
            state: AuthState::UnsupportedApiKey,
            account_email: None,
            requires_openai_auth,
            raw_auth_mode,
            message: Some(
                "API-key authentication is not supported in minico. Logout and continue with ChatGPT login."
                    .to_string(),
            ),
        },
        _ => AuthStatus {
            state: AuthState::LoginRequired,
            account_email: None,
            requires_openai_auth,
            raw_auth_mode,
            message: None,
        },
    }
}

fn parse_login_start_result(payload: &Value) -> Result<AuthLoginStartResult, String> {
    let auth_url = payload
        .get("authUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| "account/login/start did not return authUrl".to_string())?;
    let login_id = payload
        .get("loginId")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    Ok(AuthLoginStartResult {
        auth_url: auth_url.to_string(),
        login_id,
    })
}

#[tauri::command]
pub fn auth_read_status(state: State<'_, SessionRuntimeState>) -> Result<AuthStatus, String> {
    with_facade(&state, |facade| {
        let payload = facade
            .account_read(false)
            .map_err(|error| error.to_string())?;
        Ok(auth_status_from_account_payload(&payload))
    })
}

#[tauri::command]
pub fn auth_login_start_chatgpt(
    state: State<'_, SessionRuntimeState>,
) -> Result<AuthLoginStartResult, String> {
    with_facade(&state, |facade| {
        let payload = facade
            .account_login_start_chatgpt()
            .map_err(|error| error.to_string())?;
        parse_login_start_result(&payload)
    })
}

#[tauri::command]
pub fn auth_logout_and_read(state: State<'_, SessionRuntimeState>) -> Result<AuthStatus, String> {
    with_facade(&state, |facade| {
        let _ = facade.account_logout().map_err(|error| error.to_string())?;
        let payload = facade
            .account_read(false)
            .map_err(|error| error.to_string())?;
        Ok(auth_status_from_account_payload(&payload))
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        auth_status_from_account_payload, parse_login_start_result, AuthLoginStartResult, AuthState,
    };

    #[test]
    fn maps_chatgpt_account_to_logged_in() {
        let status = auth_status_from_account_payload(&json!({
            "account": {
                "type": "chatgpt",
                "email": "demo@example.com"
            },
            "requiresOpenaiAuth": false
        }));
        assert_eq!(status.state, AuthState::LoggedIn);
        assert_eq!(status.account_email.as_deref(), Some("demo@example.com"));
    }

    #[test]
    fn maps_apikey_account_to_unsupported_state() {
        let status = auth_status_from_account_payload(&json!({
            "account": {
                "type": "apikey"
            },
            "requiresOpenaiAuth": false
        }));
        assert_eq!(status.state, AuthState::UnsupportedApiKey);
        assert!(status.message.is_some());
    }

    #[test]
    fn maps_missing_account_to_login_required() {
        let status = auth_status_from_account_payload(&json!({
            "account": null,
            "requiresOpenaiAuth": true
        }));
        assert_eq!(status.state, AuthState::LoginRequired);
        assert!(status.requires_openai_auth);
    }

    #[test]
    fn parses_login_start_response() {
        let parsed = parse_login_start_result(&json!({
            "type": "chatgpt",
            "loginId": "login-1",
            "authUrl": "https://example.com/auth"
        }))
        .expect("parse");
        assert_eq!(
            parsed,
            AuthLoginStartResult {
                auth_url: "https://example.com/auth".to_string(),
                login_id: Some("login-1".to_string()),
            }
        );
    }
}
