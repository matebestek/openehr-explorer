//! Better Platform forms (PRD-0020).
//!
//! Better stores form definitions next to the CDR, under its native API:
//!
//! - `GET {base_url}/rest/v1/form` → `{ forms: [..] }`, one entry per
//!   **version** (there is no versions endpoint; group by name instead)
//! - `GET {base_url}/rest/v1/form/{name}/{version}?resources=a,b,..` →
//!   `{ meta: { href }, form: { .., resources: [{ name, mimetype, href, content }] } }`;
//!   `content` is only filled for resources named in `resources`. Naming a
//!   resource the form doesn't have fails the whole request with 404
//!   FORM-5721 (as does `*`), so `get_form` first fetches the form without
//!   `resources` to learn which ones it has, then asks for exactly those.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::server::{create_client, get_profile_by_id, make_request, ServerType};
use crate::inspector::send_instrumented;

#[derive(Debug, Clone, Serialize)]
pub struct FormSummary {
    pub name: String,
    pub version: String,
    pub template_id: Option<String>,
    pub created_timestamp: Option<String>,
    pub status: Option<String>,
    pub category: Option<String>,
    pub creator: Option<String>,
    /// Better's `type` attribute (e.g. `JSON`).
    pub form_type: Option<String>,
    pub schema_version: Option<String>,
    /// String-valued tags only, e.g. `_form_labels`, `_username`, `_revision_comment`.
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FormResource {
    pub name: String,
    pub mimetype: Option<String>,
    pub href: Option<String>,
    /// `None` for an empty resource; a JSON string for `text/plain` ones.
    pub content: Option<Value>,
    /// Whether this resource's content was asked for. One that wasn't arrives
    /// without content even when it has some, so the view must not call it
    /// "empty".
    pub requested: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FormDefinition {
    pub summary: FormSummary,
    pub href: Option<String>,
    pub resources: Vec<FormResource>,
    /// The form object exactly as the server sent it, minus `resources` —
    /// so attributes and non-string tags this app doesn't model stay visible.
    pub raw: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawForm {
    name: String,
    version: String,
    template_id: Option<String>,
    created_timestamp: Option<String>,
    status: Option<String>,
    category: Option<String>,
    creator: Option<String>,
    #[serde(rename = "type")]
    form_type: Option<String>,
    schema_version: Option<String>,
    #[serde(default)]
    tags: Option<serde_json::Map<String, Value>>,
    #[serde(default)]
    resources: Vec<RawResource>,
}

#[derive(Deserialize)]
struct RawResource {
    name: String,
    mimetype: Option<String>,
    href: Option<String>,
    content: Option<Value>,
}

#[derive(Deserialize)]
struct RawFormList {
    #[serde(default)]
    forms: Vec<RawForm>,
}

#[derive(Deserialize)]
struct RawMeta {
    href: Option<String>,
}

#[derive(Deserialize)]
struct RawFormResponse {
    meta: Option<RawMeta>,
    form: RawForm,
}

impl RawForm {
    fn summary(self) -> (FormSummary, Vec<RawResource>) {
        let tags = self
            .tags
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
            .collect();
        (
            FormSummary {
                name: self.name,
                version: self.version,
                template_id: self.template_id,
                created_timestamp: self.created_timestamp,
                status: self.status,
                category: self.category,
                creator: self.creator,
                form_type: self.form_type,
                schema_version: self.schema_version,
                tags,
            },
            self.resources,
        )
    }
}

fn better_api_root(base_url: &str) -> String {
    format!("{}/rest/v1", base_url.trim_end_matches('/'))
}

fn forms_list_url(base_url: &str) -> String {
    format!("{}/form", better_api_root(base_url))
}

fn form_url(base_url: &str, name: &str, version: &str, resources: &[String]) -> String {
    let url = format!(
        "{}/form/{}/{}",
        better_api_root(base_url),
        urlencoding::encode(name),
        urlencoding::encode(version)
    );
    if resources.is_empty() {
        return url;
    }
    let names: Vec<String> = resources
        .iter()
        .map(|n| urlencoding::encode(n).into_owned())
        .collect();
    format!("{url}?resources={}", names.join(","))
}

/// The names of the resources a form version has, from a response fetched
/// without `resources`.
fn resource_names(body: &str) -> Result<Vec<String>, String> {
    let parsed: RawFormResponse =
        serde_json::from_str(body).map_err(|e| format!("Unexpected form response: {e}"))?;
    Ok(parsed.form.resources.into_iter().map(|r| r.name).collect())
}

fn parse_forms_list(body: &str) -> Result<Vec<FormSummary>, String> {
    let raw: RawFormList = serde_json::from_str(body)
        .map_err(|e| format!("Unexpected response listing forms: {e}"))?;
    Ok(raw.forms.into_iter().map(|f| f.summary().0).collect())
}

fn parse_form_definition(body: &str, requested: &[String]) -> Result<FormDefinition, String> {
    let value: Value =
        serde_json::from_str(body).map_err(|e| format!("Unexpected form response: {e}"))?;
    let mut raw_form = value.get("form").cloned().unwrap_or(Value::Null);
    if let Some(obj) = raw_form.as_object_mut() {
        obj.remove("resources");
    }
    let parsed: RawFormResponse =
        serde_json::from_value(value).map_err(|e| format!("Unexpected form response: {e}"))?;
    let (summary, resources) = parsed.form.summary();
    Ok(FormDefinition {
        summary,
        href: parsed.meta.and_then(|m| m.href),
        raw: raw_form,
        resources: resources
            .into_iter()
            .map(|r| FormResource {
                requested: requested.contains(&r.name),
                name: r.name,
                mimetype: r.mimetype,
                href: r.href,
                content: r.content.filter(|c| !c.is_null()),
            })
            .collect(),
    })
}

fn server_type_name(server_type: &ServerType) -> &'static str {
    match server_type {
        ServerType::Ehrbase => "EHRbase",
        ServerType::BetterPlatform => "Better Platform",
        ServerType::FerroEhr => "FerroEHR",
        ServerType::Generic => "Generic",
    }
}

/// Rejects non-Better profiles for a Better-only feature (`"Forms"`, `"Views"`).
pub(crate) fn ensure_better(feature: &str, server_type: &ServerType) -> Result<(), String> {
    match server_type {
        ServerType::BetterPlatform => Ok(()),
        other => Err(format!(
            "{feature} are a Better Platform feature; this server profile's type is {}.",
            server_type_name(other)
        )),
    }
}

async fn get_json(
    app: &tauri::AppHandle,
    server_id: &str,
    url_for: impl Fn(&str) -> String,
) -> Result<String, String> {
    let profile = get_profile_by_id(server_id)?;
    ensure_better("Forms", &profile.server_type)?;
    let url = url_for(&profile.base_url);
    let client = create_client(&profile);
    let resp = send_instrumented(
        app,
        &client,
        make_request(&client, reqwest::Method::GET, &url, &profile.auth_method)
            .header("Accept", "application/json"),
    )
    .await?;
    if !resp.is_success {
        return Err(format!(
            "Server returned HTTP {}: {}",
            resp.status, resp.body
        ));
    }
    Ok(resp.body)
}

/// Every form entry (one per version) on a Better server.
#[tauri::command]
pub async fn list_forms(
    app: tauri::AppHandle,
    server_id: String,
) -> Result<Vec<FormSummary>, String> {
    let body = get_json(&app, &server_id, forms_list_url).await?;
    parse_forms_list(&body)
}

/// One form version with all of its resources.
#[tauri::command]
pub async fn get_form(
    app: tauri::AppHandle,
    server_id: String,
    name: String,
    version: String,
) -> Result<FormDefinition, String> {
    let listing = get_json(&app, &server_id, |base| {
        form_url(base, &name, &version, &[])
    })
    .await?;
    let names = resource_names(&listing)?;
    if names.is_empty() {
        return parse_form_definition(&listing, &[]);
    }
    let body = get_json(&app, &server_id, |base| {
        form_url(base, &name, &version, &names)
    })
    .await?;
    parse_form_definition(&body, &names)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_forms_list_url() {
        assert_eq!(
            forms_list_url("https://cdr.example/ehr/"),
            "https://cdr.example/ehr/rest/v1/form"
        );
    }

    #[test]
    fn test_form_url_without_resources_has_no_query() {
        assert_eq!(
            form_url(
                "https://cdr.example/ehr",
                "Anamnesis View Cytology Report",
                "1.0.9",
                &[]
            ),
            "https://cdr.example/ehr/rest/v1/form/Anamnesis%20View%20Cytology%20Report/1.0.9"
        );
        assert!(
            form_url("https://cdr.example/ehr", "Anamneza čšž", "1.0.1", &[])
                .ends_with("/form/Anamneza%20%C4%8D%C5%A1%C5%BE/1.0.1")
        );
    }

    #[test]
    fn test_form_url_requests_only_the_given_resources() {
        let names = vec!["form-description".to_string(), "form-layout".to_string()];
        assert_eq!(
            form_url("https://cdr.example/ehr", "Alerts", "1.0.3", &names),
            "https://cdr.example/ehr/rest/v1/form/Alerts/1.0.3?resources=form-description,form-layout"
        );
    }

    #[test]
    fn test_resource_names_lists_what_the_form_has() {
        // A form missing some resources: asking for those makes Better answer
        // 404 FORM-5721 for the whole form, so only these may be requested.
        let body = r#"{"meta":{"href":"h"},"form":{"name":"A","version":"1.0.9","resources":[
            {"name":"form-description","content":null},{"name":"form-layout","content":null}]}}"#;
        assert_eq!(
            resource_names(body).unwrap(),
            vec!["form-description".to_string(), "form-layout".to_string()]
        );
    }

    #[test]
    fn test_parse_forms_list_maps_fields_and_string_tags() {
        let body = r#"{"forms":[{"templateId":"Anamnesis","name":"Anamnesis","version":"1.0.157","createdTimestamp":"2022-04-21T13:24:44.415Z","status":"active","category":"default","creator":"admin","type":"JSON","schemaVersion":"2.3","tags":{"_form_labels":"REQUEST","_username":"janez.erzen@better.care","n":1}}]}"#;
        let forms = parse_forms_list(body).unwrap();
        assert_eq!(forms[0].template_id.as_deref(), Some("Anamnesis"));
        assert_eq!(forms[0].form_type.as_deref(), Some("JSON"));
        assert_eq!(
            forms[0].tags.get("_form_labels").map(String::as_str),
            Some("REQUEST")
        );
        assert!(!forms[0].tags.contains_key("n"));
    }

    #[test]
    fn test_parse_form_definition_keeps_null_and_text_resources() {
        let body = r#"{"meta":{"href":"https://cdr.example/ehr/rest/v1/form/Anamnesis/1.0.157"},"form":{"name":"Anamnesis","version":"1.0.157","tags":{},
          "resources":[{"name":"form-metadata","mimetype":"application/json","href":"h1","content":null},
                       {"name":"templates","mimetype":"text/plain","href":"h2","content":"abc"},
                       {"name":"form-layout","mimetype":"application/json","href":"h3","content":[{"col":1}]}]}}"#;
        let requested = vec![
            "form-metadata".to_string(),
            "templates".to_string(),
            "form-layout".to_string(),
        ];
        let def = parse_form_definition(body, &requested).unwrap();
        assert_eq!(
            def.href.as_deref(),
            Some("https://cdr.example/ehr/rest/v1/form/Anamnesis/1.0.157")
        );
        assert_eq!(def.resources.len(), 3);
        assert!(def.resources[0].content.is_none());
        assert_eq!(def.resources[1].content, Some(serde_json::json!("abc")));
    }

    #[test]
    fn test_parse_form_definition_keeps_everything_raw_and_marks_unrequested_resources() {
        let body = r#"{"meta":{"href":"h"},"form":{"name":"A","version":"1.0.0",
          "tags":{"_form_labels":"VIEW","count":3},"newAttribute":{"x":1},
          "resources":[{"name":"form-layout","content":[1]},
                       {"name":"form-extra","content":null}]}}"#;
        let def = parse_form_definition(body, &["form-layout".to_string()]).unwrap();
        // Nothing is dropped: the raw form keeps non-string tags and unknown attributes.
        assert_eq!(def.raw["tags"]["count"], serde_json::json!(3));
        assert_eq!(def.raw["newAttribute"]["x"], serde_json::json!(1));
        assert!(def.raw.get("resources").is_none());
        assert!(def.resources[0].requested);
        assert!(!def.resources[1].requested);
    }

    #[test]
    fn test_parse_rejects_html() {
        assert!(parse_forms_list("<!doctype html>").is_err());
    }

    #[test]
    fn test_ensure_better_rejects_other_server_types() {
        assert!(ensure_better("Forms", &ServerType::BetterPlatform).is_ok());
        assert_eq!(
            ensure_better("Forms", &ServerType::Ehrbase).unwrap_err(),
            "Forms are a Better Platform feature; this server profile's type is EHRbase."
        );
    }
}
