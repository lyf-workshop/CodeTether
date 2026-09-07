use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

const CODEX_GUIDANCE_URL: &str = "https://developers.openai.com/codex/cli";
const CLAUDE_GUIDANCE_URL: &str = "https://docs.anthropic.com/en/docs/claude-code/getting-started";

fn provider_guidance_url(provider: &str) -> Option<&'static str> {
    match provider {
        "codex" => Some(CODEX_GUIDANCE_URL),
        "claude-code" => Some(CLAUDE_GUIDANCE_URL),
        _ => None,
    }
}

/// Opens one compile-time allowlisted Provider guide. The Web cannot supply a
/// URL, executable, argument list, or shell command through this boundary.
#[tauri::command]
pub fn open_provider_guidance(app: AppHandle, provider: String) -> Result<(), String> {
    let url = provider_guidance_url(&provider)
        .ok_or_else(|| "Unsupported Provider guidance request".to_string())?;
    #[allow(deprecated)]
    app.shell()
        .open(url, None)
        .map_err(|_| "Provider guidance could not be opened".to_string())
}

#[cfg(test)]
mod tests {
    use super::{CLAUDE_GUIDANCE_URL, CODEX_GUIDANCE_URL, provider_guidance_url};

    #[test]
    fn guidance_is_exactly_allowlisted_by_provider() {
        assert_eq!(provider_guidance_url("codex"), Some(CODEX_GUIDANCE_URL));
        assert_eq!(
            provider_guidance_url("claude-code"),
            Some(CLAUDE_GUIDANCE_URL)
        );
        assert_eq!(provider_guidance_url("https://example.test"), None);
        assert_eq!(provider_guidance_url(""), None);
    }
}
