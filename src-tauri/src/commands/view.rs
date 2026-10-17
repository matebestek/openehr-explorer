//! Better Platform views (PRD-0021).
//!
//! This Better version has no REST endpoint for views; its admin console
//! serves them (same Basic credentials as the CDR):
//!
//! - `GET {base_url}/adminconsole/views?criteria=&page=N` — server-rendered
//!   HTML, one table row per view (name link, description, step names)
//! - `GET {base_url}/adminconsole/views?download=1&name=X` — the view's JSON
//!   `{ name, category, description, metaData, steps: [{ processorName, processorData }] }`
//!
//! Only these two are ever requested — never the console's `delete=1` or
//! `debug=` actions. HTML is read by plain string scanning (no HTML crate).

use serde::Serialize;
use serde_json::Value;

use super::form::ensure_better;
use super::server::{create_client, get_profile_by_id, make_request};
use crate::inspector::send_instrumented;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ViewSummary {
    pub name: String,
    pub description: Option<String>,
    /// Processor names of the view's steps, e.g. `jsonAql`, `js`.
    pub steps: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ViewParameter {
    pub name: String,
    /// The parameter's declared `type`.
    pub param_type: Option<String>,
    pub format: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ViewStep {
    pub processor_name: String,
    /// The step's code or configuration: AQL, FreeMarker, JavaScript, ...
    pub processor_data: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ViewDefinition {
    pub name: String,
    pub category: Option<String>,
    pub description: Option<String>,
    pub parameters: Vec<ViewParameter>,
    pub steps: Vec<ViewStep>,
    /// The definition exactly as downloaded.
    pub raw: Value,
}

/// Upper bound on admin-console pages fetched for the view list. The page
/// count is read from the page itself, so it must not drive an unbounded
/// number of requests (the user's server has 2 pages of ~20 views).
const MAX_PAGES: u32 = 50;

fn console_views_url(base_url: &str) -> String {
    format!("{}/adminconsole/views", base_url.trim_end_matches('/'))
}

fn views_page_url(base_url: &str, page: u32) -> String {
    format!("{}?criteria=&page={page}", console_views_url(base_url))
}

fn view_download_url(base_url: &str, name: &str) -> String {
    format!(
        "{}?download=1&name={}",
        console_views_url(base_url),
        urlencoding::encode(name)
    )
}

fn unescape_html(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

/// The text of the next `<td>` at or after `from`, and the index after it.
fn next_cell(html: &str, from: usize) -> Option<(String, usize)> {
    let open = from + html[from..].find("<td")?;
    let tag_end = open + html[open..].find('>')?;
    if html[..tag_end].ends_with('/') {
        return Some((String::new(), tag_end + 1));
    }
    let close = tag_end + html[tag_end..].find("</td>")?;
    let text = unescape_html(strip_tags(&html[tag_end + 1..close]).trim());
    Some((text, close + "</td>".len()))
}

/// The views listed on one console page, and the highest page number linked.
fn parse_views_page(html: &str) -> (Vec<ViewSummary>, u32) {
    const NAME_LINK: &str = "views?name=";
    let mut views = Vec::new();
    let mut pos = 0;
    while let Some(found) = html[pos..].find(NAME_LINK) {
        let start = pos + found + NAME_LINK.len();
        let Some(quote) = html[start..].find('"') else {
            break;
        };
        let encoded = unescape_html(&html[start..start + quote]);
        let name = urlencoding::decode(&encoded)
            .map(|n| n.into_owned())
            .unwrap_or(encoded);
        let after_name = html[start..]
            .find("</td>")
            .map(|i| start + i + "</td>".len())
            .unwrap_or(start);
        let (description, after_desc) =
            next_cell(html, after_name).unwrap_or((String::new(), after_name));
        let (steps, after_steps) =
            next_cell(html, after_desc).unwrap_or((String::new(), after_desc));
        views.push(ViewSummary {
            name,
            description: Some(description).filter(|d| !d.is_empty()),
            // The console separates step names with ", " and line breaks.
            steps: steps
                .split(|c: char| c == ',' || c.is_whitespace())
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect(),
        });
        pos = after_steps.max(start);
    }

    let mut max_page = 1;
    let mut rest = html;
    while let Some(i) = rest.find("page=") {
        rest = &rest[i + "page=".len()..];
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        if let Ok(n) = digits.parse::<u32>() {
            max_page = max_page.max(n);
        }
    }
    (views, max_page.min(MAX_PAGES))
}

fn opt_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(String::from)
}

fn parse_view_definition(body: &str) -> Result<ViewDefinition, String> {
    let raw: Value = serde_json::from_str(body)
        .map_err(|e| format!("Unexpected view definition (not JSON): {e}"))?;
    let name = opt_str(&raw, "name").ok_or("View definition has no name")?;
    // metaData arrives as an object, a JSON-encoded string, or null.
    let meta = match raw.get("metaData") {
        Some(Value::String(s)) => serde_json::from_str(s).unwrap_or(Value::Null),
        Some(other) => other.clone(),
        None => Value::Null,
    };
    let parameters = meta
        .get("parameters")
        .and_then(Value::as_array)
        .map(|params| {
            params
                .iter()
                .filter_map(|p| {
                    Some(ViewParameter {
                        name: opt_str(p, "name")?,
                        param_type: opt_str(p, "type"),
                        format: opt_str(p, "format"),
                        description: opt_str(p, "description"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let steps = raw
        .get("steps")
        .and_then(Value::as_array)
        .map(|steps| {
            steps
                .iter()
                .map(|s| ViewStep {
                    processor_name: opt_str(s, "processorName").unwrap_or_default(),
                    processor_data: match s.get("processorData") {
                        Some(Value::String(d)) => d.clone(),
                        Some(Value::Null) | None => String::new(),
                        Some(other) => other.to_string(),
                    },
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(ViewDefinition {
        name,
        category: opt_str(&raw, "category"),
        description: opt_str(&raw, "description"),
        parameters,
        steps,
        raw,
    })
}

async fn get_console(
    app: &tauri::AppHandle,
    server_id: &str,
    url: impl Fn(&str) -> String,
) -> Result<String, String> {
    let profile = get_profile_by_id(server_id)?;
    ensure_better("Views", &profile.server_type)?;
    let url = url(&profile.base_url);
    let client = create_client(&profile);
    let resp = send_instrumented(
        app,
        &client,
        make_request(&client, reqwest::Method::GET, &url, &profile.auth_method),
    )
    .await?;
    if !resp.is_success {
        return Err(format!(
            "Admin console returned HTTP {} for {url}",
            resp.status
        ));
    }
    Ok(resp.body)
}

/// Every view on the server, from all admin-console pages, sorted by name.
#[tauri::command]
pub async fn list_views(
    app: tauri::AppHandle,
    server_id: String,
) -> Result<Vec<ViewSummary>, String> {
    let first = get_console(&app, &server_id, |base| views_page_url(base, 1)).await?;
    let (mut views, max_page) = parse_views_page(&first);
    for page in 2..=max_page {
        let html = get_console(&app, &server_id, |base| views_page_url(base, page)).await?;
        let new: Vec<ViewSummary> = parse_views_page(&html)
            .0
            .into_iter()
            .filter(|v| !views.iter().any(|seen| seen.name == v.name))
            .collect();
        // A page with nothing new means the listing has ended (or repeats).
        if new.is_empty() {
            break;
        }
        views.extend(new);
    }
    views.sort_by_key(|v| v.name.to_lowercase());
    views.dedup_by(|a, b| a.name == b.name);
    Ok(views)
}

/// One view's full definition.
#[tauri::command]
pub async fn get_view(
    app: tauri::AppHandle,
    server_id: String,
    name: String,
) -> Result<ViewDefinition, String> {
    let body = get_console(&app, &server_id, |base| view_download_url(base, &name)).await?;
    parse_view_definition(&body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::server::ServerType;

    const PAGE: &str = r#"<html><body>
        <ul class="pagination"><li><a href="/ehr/adminconsole/views?criteria=&page=1">1</a></li>
        <li><a href="/ehr/adminconsole/views?criteria=&page=2">2</a></li></ul>
        <table class="table"><thead><tr><th>Admin</th><th>Name</th><th>Description</th><th>Steps</th></tr></thead>
        <tbody>
            <tr>
                <td><a res-name="allergy" class="confirmdelete"
                       href="/ehr/adminconsole/views?delete=1&name=allergy">[Del]</a></td>
                <td><a href="/ehr/adminconsole/views?name=allergy">allergy</a></td>
                <td>Gets allergies &amp; intolerances</td>
                <td>
                        jsonAql
                </td>
                <td><a href="/ehr/adminconsole/views?download=1&name=allergy">[Download]</a></td>
                <td/>
            </tr>
            <tr>
                <td><a href="/ehr/adminconsole/views?delete=1&name=Laboratory%20-%20Cytology%20-%20Load%20cytology%20summary">[Del]</a></td>
                <td><a href="/ehr/adminconsole/views?name=Laboratory%20-%20Cytology%20-%20Load%20cytology%20summary">Laboratory - Cytology - Load cytology summary</a></td>
                <td></td>
                <td> jsonFtlAql
                     , js </td>
                <td><a href="/ehr/adminconsole/views?download=1&name=Laboratory%20-%20Cytology%20-%20Load%20cytology%20summary">[Download]</a></td>
                <td><a href="/ehr/adminconsole/views?debug=x&page=1&criteria=">[Debug]</a></td>
            </tr>
        </tbody></table></body></html>"#;

    #[test]
    fn test_views_page_url() {
        assert_eq!(
            views_page_url("https://cdr.example/ehr/", 2),
            "https://cdr.example/ehr/adminconsole/views?criteria=&page=2"
        );
    }

    #[test]
    fn test_view_download_url_encodes_name() {
        assert_eq!(
            view_download_url("https://cdr.example/ehr", "Get HPV reports"),
            "https://cdr.example/ehr/adminconsole/views?download=1&name=Get%20HPV%20reports"
        );
        assert!(view_download_url("https://cdr.example/ehr", "Kajenje č")
            .ends_with("name=Kajenje%20%C4%8D"));
    }

    #[test]
    fn test_parse_views_page_reads_rows_and_last_page() {
        let (views, max_page) = parse_views_page(PAGE);
        assert_eq!(max_page, 2);
        assert_eq!(views.len(), 2);
        assert_eq!(views[0].name, "allergy");
        assert_eq!(
            views[0].description.as_deref(),
            Some("Gets allergies & intolerances")
        );
        assert_eq!(views[0].steps, vec!["jsonAql".to_string()]);
        assert_eq!(
            views[1].name,
            "Laboratory - Cytology - Load cytology summary"
        );
        assert_eq!(views[1].description, None);
        assert_eq!(
            views[1].steps,
            vec!["jsonFtlAql".to_string(), "js".to_string()]
        );
    }

    #[test]
    fn test_parse_views_page_caps_the_page_count() {
        // A page number from the page's own content must not make the app
        // send an unbounded number of requests.
        let html = r#"<a href="/ehr/adminconsole/views?criteria=&page=999999">x</a>"#;
        assert_eq!(parse_views_page(html).1, MAX_PAGES);
    }

    #[test]
    fn test_parse_views_page_empty_table() {
        let (views, max_page) = parse_views_page("<table><tbody></tbody></table>");
        assert!(views.is_empty());
        assert_eq!(max_page, 1);
    }

    #[test]
    fn test_parse_view_definition_metadata_shapes() {
        let with_object = r#"{"name":"v","category":"view","description":"d",
            "metaData":{"parameters":[{"name":"from","type":"string","format":"date-time","description":"Limit"},
                                      {"name":"ehrId","type":"string"}]},
            "steps":[{"processorName":"jsonAql","processorData":"select 1"}]}"#;
        let def = parse_view_definition(with_object).unwrap();
        assert_eq!(def.parameters.len(), 2);
        assert_eq!(def.parameters[0].param_type.as_deref(), Some("string"));
        assert_eq!(def.parameters[0].format.as_deref(), Some("date-time"));
        assert_eq!(def.parameters[1].format, None);
        assert_eq!(def.steps[0].processor_name, "jsonAql");
        assert_eq!(def.steps[0].processor_data, "select 1");
        assert_eq!(def.raw["metaData"]["parameters"][1]["name"], "ehrId");

        let as_string =
            r#"{"name":"v","metaData":"{\"parameters\":[{\"name\":\"x\"}]}","steps":[]}"#;
        assert_eq!(
            parse_view_definition(as_string).unwrap().parameters[0].name,
            "x"
        );

        let as_null = r#"{"name":"v","metaData":null,"steps":[]}"#;
        assert!(parse_view_definition(as_null)
            .unwrap()
            .parameters
            .is_empty());
    }

    #[test]
    fn test_parse_view_definition_rejects_html() {
        assert!(parse_view_definition("<!doctype html><html>login</html>").is_err());
    }

    #[test]
    fn test_ensure_better_names_the_feature() {
        assert_eq!(
            super::super::form::ensure_better("Views", &ServerType::Generic).unwrap_err(),
            "Views are a Better Platform feature; this server profile's type is Generic."
        );
    }
}
