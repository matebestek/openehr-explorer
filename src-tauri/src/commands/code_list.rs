//! Code lists from a deployment-specific code-list service (PRD-0019).
//!
//! Some templates (confirmed: Better CDRs behind the Zorica portal) use
//! template-local code systems such as `A06_smoking` whose codes appear in
//! neither the Web Template nor the OPT — Better forms load them at runtime
//! from a terminology adapter:
//!
//! - `GET {base}/codesystem/{id}` → `{ code, languages: [..], .. }`
//! - `GET {base}/codesystem/{id}/entities?pagesize=N&language=xx`
//!   → `{ items: [{ code, description, user_code }], lastPage }`
//!
//! The service needs no login, so CDR credentials are never sent to it.

use serde::{Deserialize, Serialize};

use super::server::{create_client, get_profile_by_id};
use crate::inspector::send_instrumented;

/// More than any code system seen in practice; the panel renders at most 200.
const PAGE_SIZE: usize = 10000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CodeListItem {
    pub code: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub user_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CodeList {
    pub code_system: String,
    pub languages: Vec<String>,
    pub items: Vec<CodeListItem>,
    /// False when the service had more entries than one page returned.
    pub complete: bool,
    /// The URL the list was fetched from (without paging), shown as its source.
    pub source_url: String,
}

#[derive(Deserialize)]
struct EntitiesResponse {
    #[serde(default)]
    items: Vec<CodeListItem>,
    #[serde(rename = "lastPage", default = "default_last_page")]
    last_page: bool,
}

fn default_last_page() -> bool {
    true
}

fn parse_entities(body: &str) -> Result<(Vec<CodeListItem>, bool), String> {
    let parsed: EntitiesResponse = serde_json::from_str(body)
        .map_err(|e| format!("Code-list service returned an unexpected response: {e}"))?;
    Ok((parsed.items, parsed.last_page))
}

fn parse_languages(body: &str) -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("languages").cloned())
        .and_then(|l| serde_json::from_value::<Vec<String>>(l).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|l| !l.is_empty())
        .collect()
}

/// `(metadata URL, entities URL)` for a code system.
fn code_list_urls(base: &str, code_system: &str, language: Option<&str>) -> (String, String) {
    let meta = format!(
        "{}/codesystem/{}",
        base.trim_end_matches('/'),
        urlencoding::encode(code_system)
    );
    let mut entities = format!("{meta}/entities?pagesize={PAGE_SIZE}");
    if let Some(lang) = language.filter(|l| !l.is_empty()) {
        entities.push_str("&language=");
        entities.push_str(&urlencoding::encode(lang));
    }
    (meta, entities)
}

/// The entities URL as a reader would want to see it: paging dropped, language kept.
fn display_source_url(entities_url: &str) -> String {
    let Some((path, query)) = entities_url.split_once('?') else {
        return entities_url.to_string();
    };
    let kept: Vec<&str> = query
        .split('&')
        .filter(|p| !p.starts_with("pagesize="))
        .collect();
    if kept.is_empty() {
        path.to_string()
    } else {
        format!("{path}?{}", kept.join("&"))
    }
}

#[tauri::command]
pub async fn get_code_list(
    app: tauri::AppHandle,
    server_id: String,
    code_system: String,
    language: Option<String>,
) -> Result<CodeList, String> {
    let profile = get_profile_by_id(&server_id)?;
    let base = profile
        .code_list_url
        .as_deref()
        .filter(|u| !u.trim().is_empty())
        .ok_or_else(|| "No code-list service URL is configured for this server.".to_string())?
        .to_string();
    let (meta_url, entities_url) = code_list_urls(&base, &code_system, language.as_deref());
    let client = create_client(&profile);

    let resp = send_instrumented(&app, &client, client.get(&entities_url)).await?;
    if !resp.is_success {
        return Err(format!(
            "Code-list service returned HTTP {} for {}",
            resp.status, code_system
        ));
    }
    let (items, complete) = parse_entities(&resp.body)?;

    // Languages are only for the panel's language switch — not worth failing over.
    let languages = match send_instrumented(&app, &client, client.get(&meta_url)).await {
        Ok(meta) if meta.is_success => parse_languages(&meta.body),
        _ => Vec::new(),
    };

    Ok(CodeList {
        code_system,
        languages,
        items,
        complete,
        source_url: display_source_url(&entities_url),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_entities_reads_items_and_last_page() {
        let body = r#"{"items":[{"code":"1","description":"Never smoked","user_code":"A06.1"},
            {"code":"2","description":"Former smoker","user_code":"A06.2"}],"lastPage":true}"#;
        let (items, last_page) = parse_entities(body).unwrap();
        assert!(last_page);
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].code, "2");
        assert_eq!(items[1].description.as_deref(), Some("Former smoker"));
        assert_eq!(items[1].user_code.as_deref(), Some("A06.2"));
    }

    #[test]
    fn test_parse_entities_tolerates_missing_optional_fields() {
        let (items, last_page) = parse_entities(r#"{"items":[{"code":"x"}]}"#).unwrap();
        assert!(
            last_page,
            "a missing lastPage means there is nothing more to fetch"
        );
        assert_eq!(items[0].description, None);
        assert_eq!(items[0].user_code, None);
    }

    #[test]
    fn test_parse_entities_rejects_non_json() {
        assert!(parse_entities("<!doctype html><html></html>").is_err());
    }

    #[test]
    fn test_parse_languages_drops_empty_entries() {
        assert_eq!(
            parse_languages(r#"{"code":"A06_smoking","languages":["sl","en",""]}"#),
            vec!["sl".to_string(), "en".to_string()]
        );
        assert!(parse_languages(r#"{"code":"x"}"#).is_empty());
    }

    #[test]
    fn test_code_list_urls_encode_code_system_and_language() {
        let (meta, entities) = code_list_urls(
            "https://cdr.example/terminology-adapter/rest/terminology/",
            "A06 smoking",
            Some("en"),
        );
        assert_eq!(
            meta,
            "https://cdr.example/terminology-adapter/rest/terminology/codesystem/A06%20smoking"
        );
        assert_eq!(
            entities,
            "https://cdr.example/terminology-adapter/rest/terminology/codesystem/A06%20smoking/entities?pagesize=10000&language=en"
        );
    }

    #[test]
    fn test_display_source_url_drops_page_size() {
        assert_eq!(
            display_source_url(
                "https://cdr.example/t/codesystem/A06_smoking/entities?pagesize=10000&language=sl"
            ),
            "https://cdr.example/t/codesystem/A06_smoking/entities?language=sl"
        );
        assert_eq!(
            display_source_url(
                "https://cdr.example/t/codesystem/A06_smoking/entities?pagesize=10000"
            ),
            "https://cdr.example/t/codesystem/A06_smoking/entities"
        );
    }

    #[test]
    fn test_code_list_urls_without_language() {
        let (_, entities) = code_list_urls("https://cdr.example/t", "A06_smoking", None);
        assert_eq!(
            entities,
            "https://cdr.example/t/codesystem/A06_smoking/entities?pagesize=10000"
        );
    }
}
