# Forms Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new **Forms** section, directly after Templates, that lists a Better Platform server's forms and shows everything in a form definition. The form list is on the left, and the selected form on the right has a version picker, header facts, and collapsible Overview, Fields, Environment, Layout and Raw JSON sections.

**Architecture:**
- Two Tauri commands in a new `src-tauri/src/commands/form.rs` call Better's `{base_url}/rest/v1/form` API.
- All interpretation is in the pure module `src/lib/forms.ts`, unit-tested with Vitest: grouping versions, type labels, the field tree with badges, the environment and the layout outline.
- A Pinia store `src/stores/form.ts` holds the list and the selected form.
- `src/views/FormBrowser.vue` renders it with three small presentational components, each with Storybook stories.

**Tech Stack:** Tauri 2 / Rust (reqwest, serde_json), Vue 3 + TypeScript, Pinia, Vitest 4 (node env, no component test utils), Storybook.

**Spec:** `docs/prd/PRD-0020-forms-browser.md`

## Global Constraints

- **Dependencies:** pinned versions; add **no** new dependencies.
- **Styling:** theme colours only via tokens in `src/styles/tokens.css`; never dim text with `opacity`; use `--color-text-secondary` or `--color-text-muted` (ADR-0028).
- **Carets:** use `CaretIcon.vue` or `CollapsibleSection.vue`; never caret glyphs (`caret-glyphs.test.ts`).
- **Stories:** every new component gets a sibling `*.stories.ts` (ADR-0021).
- **Better only:** forms exist only on `server_type: "better_platform"`. The Forms sidebar entry is **always shown**; on other server types the page shows an empty state explaining that forms are a Better Platform feature, with a link to `/servers`.
- **Sidebar order:** Overview, EHR Browser, Templates, **Forms**, AQL Runner, Terminology, Servers (so Forms gets Ctrl/Cmd+4).
- **Routes:** `/forms` (name `forms`) and `/forms/:name/:version` (name `form-detail`).
- **Read-only:** no create, edit, publish or delete, and no form rendering.
- **Requests:** the base is `{profile.base_url}/rest/v1`, sent with the profile's CDR auth through `send_instrumented`. Percent-encode `name` and `version` path segments, since names contain spaces and č/š/ž.
- **Resource names** requested explicitly in this order: `form-description,form-layout,form-environment,form-metadata,app-pages,widget-configuration,templates`. (`resources=*` is rejected.)
- **Analytics:** one event `forms_viewed` with **no properties** when a form version is opened; add it to `useAnalytics.ts`'s event union and to ADR-0018's event list.
- **Commits:** Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Version order:** `1.0.20` vs `1.0.157` must sort numerically (newest first), never as strings, with up to 76 versions per name. Pinned in Task 2.
- **Names with spaces and Slovenian letters** (`Anamnesis Treatment`, `P-Status nepregledanih vzorcev`, č/š/ž) must reach the right URL. Pinned in Task 1.
- **Field-tree nodes** without `viewConfig`, without `localizedNames` for the chosen language, or with no `children`: the node still renders with a fallback label and no badges. Pinned in Task 3.
- **`_form_labels`** with commas and spaces (`Gineko Portal,CLINICAL FORM`, `HISTOPATO Z2 2345,Deprecated`) or missing tags: split and trim, missing means "No type". Pinned in Task 2.
- **A non-Better profile** asking for forms gets the clear error `"Forms are a Better Platform feature; this server profile's type is <type>."` rather than a 404 or HTML parse error. Pinned in Task 1.

---

### Task 1: Backend form commands

**Files:**
- Create: `src-tauri/src/commands/form.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod form;`), `src-tauri/src/lib.rs` (`use commands::{…, form, …}`; register `form::list_forms`, `form::get_form`)

**Interfaces:**
- Produces (serialized snake_case over IPC):
  ```rust
  pub struct FormSummary { pub name: String, pub version: String, pub template_id: Option<String>,
      pub created_timestamp: Option<String>, pub status: Option<String>, pub category: Option<String>,
      pub creator: Option<String>, pub form_type: Option<String> /* JSON "type" */,
      pub schema_version: Option<String>, pub tags: std::collections::BTreeMap<String, String> }
  pub struct FormResource { pub name: String, pub mimetype: Option<String>, pub href: Option<String>,
      pub content: Option<serde_json::Value> /* text/plain arrives as a JSON string */ }
  pub struct FormDefinition { pub summary: FormSummary, pub href: Option<String>, pub resources: Vec<FormResource> }
  #[tauri::command] pub async fn list_forms(app, server_id: String) -> Result<Vec<FormSummary>, String>;
  #[tauri::command] pub async fn get_form(app, server_id: String, name: String, version: String) -> Result<FormDefinition, String>;
  ```
  The incoming JSON uses camelCase (`templateId`, `createdTimestamp`, `schemaVersion`) and `type`; map it with serde renames. Tag values that aren't strings are skipped.

- [ ] **Step 1: Write the failing tests** in `form.rs`'s `#[cfg(test)] mod tests`:

```rust
#[test] fn test_forms_list_url() {
    assert_eq!(forms_list_url("https://cdr.example/ehr/"), "https://cdr.example/ehr/rest/v1/form");
}
#[test] fn test_form_url_encodes_name_and_requests_all_resources() {
    assert_eq!(form_url("https://cdr.example/ehr", "P-Status nepregledanih vzorcev", "1.0.20"),
        "https://cdr.example/ehr/rest/v1/form/P-Status%20nepregledanih%20vzorcev/1.0.20?resources=form-description,form-layout,form-environment,form-metadata,app-pages,widget-configuration,templates");
    assert!(form_url("https://cdr.example/ehr", "Anamneza čšž", "1.0.1").contains("/form/Anamneza%20%C4%8D%C5%A1%C5%BE/1.0.1?"));
}
#[test] fn test_parse_forms_list_maps_fields_and_string_tags() {
    let body = r#"{"forms":[{"templateId":"Anamnesis","name":"Anamnesis","version":"1.0.157","createdTimestamp":"2022-04-21T13:24:44.415Z","status":"active","category":"default","creator":"admin","type":"JSON","schemaVersion":"2.3","tags":{"_form_labels":"REQUEST","_username":"janez.erzen@better.care","n":1}}]}"#;
    let forms = parse_forms_list(body).unwrap();
    assert_eq!(forms[0].template_id.as_deref(), Some("Anamnesis"));
    assert_eq!(forms[0].form_type.as_deref(), Some("JSON"));
    assert_eq!(forms[0].tags.get("_form_labels").map(String::as_str), Some("REQUEST"));
    assert!(!forms[0].tags.contains_key("n"));
}
#[test] fn test_parse_form_definition_keeps_null_and_text_resources() {
    let body = r#"{"meta":{"href":"https://cdr.example/ehr/rest/v1/form/Anamnesis/1.0.157"},"form":{"name":"Anamnesis","version":"1.0.157","tags":{},
      "resources":[{"name":"form-metadata","mimetype":"application/json","href":"h1","content":null},
                   {"name":"templates","mimetype":"text/plain","href":"h2","content":"abc"},
                   {"name":"form-layout","mimetype":"application/json","href":"h3","content":[{"col":1}]}]}}"#;
    let def = parse_form_definition(body).unwrap();
    assert_eq!(def.href.as_deref(), Some("https://cdr.example/ehr/rest/v1/form/Anamnesis/1.0.157"));
    assert_eq!(def.resources.len(), 3);
    assert!(def.resources[0].content.is_none());
    assert_eq!(def.resources[1].content, Some(serde_json::json!("abc")));
}
#[test] fn test_parse_rejects_html() { assert!(parse_forms_list("<!doctype html>").is_err()); }
#[test] fn test_ensure_better_rejects_other_server_types() {
    assert!(ensure_better(&ServerType::BetterPlatform).is_ok());
    assert_eq!(ensure_better(&ServerType::Ehrbase).unwrap_err(),
        "Forms are a Better Platform feature; this server profile's type is EHRbase.");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test form::`
Expected: compile errors, the functions aren't defined yet.

- [ ] **Step 3: Implement** in `form.rs`: `forms_list_url(base_url: &str) -> String`, `form_url(base_url: &str, name: &str, version: &str) -> String`, `parse_forms_list(body: &str) -> Result<Vec<FormSummary>, String>`, `parse_form_definition(body: &str) -> Result<FormDefinition, String>`, `ensure_better(server_type: &ServerType) -> Result<(), String>` (display names: `EHRbase`, `Better Platform`, `FerroEHR`, `Generic`), and the two commands. On a non-2xx response the commands return `"Server returned HTTP {status}: {body}"`. Requests go through `make_request(&client, GET, url, &profile.auth_method).header("Accept", "application/json")`.

- [ ] **Step 4: Verify**

Run: `cd src-tauri && cargo fmt && cargo test form:: && cargo clippy -- -D warnings`
Expected: 6 tests pass, clippy clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/form.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(forms): add Better form list and form definition commands"
```

---

### Task 2: Grouping, versions and type labels

**Files:**
- Create: `src/lib/forms.ts`, `src/lib/forms.test.ts`

**Interfaces:**
- Consumes: Task 1's JSON shapes, mirrored as TS interfaces `FormSummary`, `FormResource` and `FormDefinition`, with the same snake_case field names. `compareVersions(a: string, b: string): number` comes from `src/lib/whats-new.ts`.
- Produces:
  ```ts
  export interface FormGroup { name: string; templateId: string | null; latest: FormSummary;
    versions: string[] /* newest first */; typeLabels: string[] }
  export const NO_TYPE = "No type";
  export function formTypeLabels(tags: Record<string, string>): string[];
  export function groupForms(entries: FormSummary[]): FormGroup[];          // sorted by name, case-insensitive
  export function typeChips(groups: FormGroup[]): string[];                  // sorted labels, NO_TYPE last if any
  export function filterGroups(groups: FormGroup[], text: string, chip: string | null): FormGroup[];
  export function listForms(serverId: string): Promise<FormSummary[]>;      // invoke("list_forms")
  export function getForm(serverId: string, name: string, version: string): Promise<FormDefinition>; // invoke("get_form")
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it("splits and trims comma-separated _form_labels; none means []", () => {
  expect(formTypeLabels({ _form_labels: "Gineko Portal, CLINICAL FORM" })).toEqual(["Gineko Portal", "CLINICAL FORM"]);
  expect(formTypeLabels({})).toEqual([]);
});
it("groups versions by name, newest first by numeric version", () => {
  const g = groupForms([e("HPV Report", "1.0.20"), e("HPV Report", "1.0.157"), e("HPV Report", "1.0.3"), e("Alerts", "1.0.3")]);
  expect(g.map((x) => x.name)).toEqual(["Alerts", "HPV Report"]);
  expect(g[1].versions).toEqual(["1.0.157", "1.0.20", "1.0.3"]);
  expect(g[1].latest.version).toBe("1.0.157");
});
it("takes template and type labels from the latest version", () => { /* latest has _form_labels "VIEW", older "REQUEST" → typeLabels ["VIEW"] */ });
it("builds chips from all labels with No type last", () => {
  expect(typeChips(groupForms([e("A", "1.0.1", "REQUEST"), e("B", "1.0.1"), e("C", "1.0.1", "CLINICAL FORM")])))
    .toEqual(["CLINICAL FORM", "REQUEST", "No type"]);
});
it("filters by text over name and template, and by chip", () => {
  // "anam" matches name "Anamnesis Treatment" and template "Anamnesis"; chip "No type" keeps only unlabelled groups
});
```

(`e(name, version, label?)` is a local factory returning a `FormSummary` with `template_id` = name's first word and `tags` = `{ _form_labels: label }` when given.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/forms.test.ts`
Expected: FAIL, because the module doesn't export these functions yet.

- [ ] **Step 3: Implement the functions above in `src/lib/forms.ts`**

Sort versions with `compareVersions` (descending). Sort names with `localeCompare(…, { sensitivity: "base" })`. The text filter is case-insensitive over `name` and `templateId`.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/lib/forms.test.ts && npx vue-tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forms.ts src/lib/forms.test.ts
git commit -m "feat(forms): group form versions and derive type labels"
```

---

### Task 3: Field tree, environment and layout view models

**Files:**
- Modify: `src/lib/forms.ts`, `src/lib/forms.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FieldBadge =
    | { kind: "hidden" } | { kind: "read-only" } | { kind: "required" } | { kind: "label-overridden" }
    | { kind: "code-list"; value: string } | { kind: "remote"; value: string };
  export interface FieldNode { key: string /* formId ?? id ?? path */; label: string; rmType: string | null;
    badges: FieldBadge[]; children: FieldNode[]; raw: Record<string, unknown> /* node minus children */ }
  export function resource(def: FormDefinition, name: string): unknown;   // content or null
  export function formLanguages(description: unknown): string[];         // union of localizedNames keys, sorted; defaultLanguage first
  export function buildFieldTree(description: unknown, language: string | null): FieldNode | null;
  export interface EnvironmentModel { variables: { name: string; type: string | null; source: string | null; mandatory: boolean; value: string | null }[];
    apis: { name: string; authType: string | null; headers: unknown[]; parameters: unknown[];
      calls: { name: string; method: string | null; url: string | null; bodyType: string | null;
        pathParams: Record<string, string>; parameters: { name: string; value: string }[]; sampleResponse: unknown }[] }[] }
  export function environmentModel(env: unknown): EnvironmentModel;      // tolerant: missing keys → empty
  export interface OutlineLine { depth: number; text: string }
  export function layoutOutline(layout: unknown): OutlineLine[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it("labels nodes in the chosen language, falling back to name", () => {
  const t = buildFieldTree({ id: "anamnesis", name: "Anamnesis", rmType: "COMPOSITION", defaultLanguage: "en",
    children: [{ id: "overall_status", formId: "anamnesis/x/overall_status", name: "Overall status",
      localizedNames: { en: "Smoking", sl: "Kajenje" }, rmType: "DV_CODED_TEXT", min: 0,
      viewConfig: { advanced: { hidden: true, overrideLabel: true } } }] }, "sl")!;
  expect(t.children[0].label).toBe("Kajenje");
  expect(t.children[0].key).toBe("anamnesis/x/overall_status");
  expect(t.children[0].badges).toEqual([{ kind: "hidden" }, { kind: "label-overridden" }]);
});
it("badges required, read-only, code list and remote data", () => {
  // node: min 1; viewConfig.field.code.readonly true; inputs [{ terminology: "A02_anamnesis_source" }, { terminology: "openehr" }];
  // viewConfig.datasource { loadRemote: true, loadRemoteUrl: "guideline" }
  // → badges in order: required, read-only, code-list "A02_anamnesis_source", remote "guideline"
});
it("renders a bare node with no viewConfig, localizedNames or children", () => {
  expect(buildFieldTree({ id: "x", name: "X" }, "sl")).toEqual({ key: "x", label: "X", rmType: null, badges: [], children: [], raw: { id: "x", name: "X" } });
});
it("lists the form's languages with the default first", () => {
  expect(formLanguages({ defaultLanguage: "sl", localizedNames: { en: "a", sl: "b" }, children: [{ localizedNames: { de: "c" } }] }))
    .toEqual(["sl", "de", "en"]);
});
it("models environment variables and external API calls", () => {
  // variables [{ name: "terminologyUrl", type: "string", source: "EXTERNALLY_PROVIDED" }]; externalApis [{ name: "Zorica Terminologies",
  //   authentication: { type: "None" }, calls: [{ name: "getTerminology", requestMethod: "GET", url: "terminologyUrl", bodyType: "JSON",
  //   pathParams: { "{codeSystem}": "Z_lymph_nodes" }, parameters: [{ name: "code", value: "1" }], sampleResponse: { items: [] } }] }]
  // → apis[0].authType "None"; calls[0] { method "GET", url "terminologyUrl", pathParams { "{codeSystem}": "Z_lymph_nodes" } }
  expect(environmentModel(undefined)).toEqual({ variables: [], apis: [] });
});
it("outlines the layout grid", () => {
  expect(layoutOutline([{ col: 1, row: 1, width: 12, children: [{ id: "anamnesis/context", rows: [{ cols: [{ width: "100%", children: [{ id: "anamnesis/context/a" }] }] }] }] }]))
    .toEqual([
      { depth: 0, text: "Cell row 1, col 1, width 12" },
      { depth: 1, text: "anamnesis/context" },
      { depth: 2, text: "Column 100%" },
      { depth: 3, text: "anamnesis/context/a" },
    ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/forms.test.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement the functions above**

Badge order: hidden, read-only, required, label-overridden, code-list (one per distinct `inputs[].terminology` that is non-empty and not `openehr`/`local`), remote (`viewConfig.datasource.loadRemote` with a non-empty `loadRemoteUrl`). **Read-only** means any `viewConfig.field.*.readonly === true` or `disabled === true`. The label falls back as `localizedNames[lang] ?? localizedName ?? name ?? id ?? "(unnamed)"`.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/lib/forms.test.ts && npx vue-tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forms.ts src/lib/forms.test.ts
git commit -m "feat(forms): field tree, environment and layout view models"
```

---

### Task 4: Store and presentational components

**Files:**
- Create: `src/stores/form.ts`
- Create: `src/components/FormFieldTree.vue` + `.stories.ts`, `src/components/FormEnvironment.vue` + `.stories.ts`, `src/components/FormLayoutOutline.vue` + `.stories.ts`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:
  ```ts
  // useFormStore (setup store, like useTemplateStore)
  groups: Ref<FormGroup[]>; listLoading: Ref<boolean>; listError: Ref<string | null>;
  selected: Ref<FormDefinition | null>; formLoading: Ref<boolean>; formError: Ref<string | null>;
  fetchForms(serverId: string): Promise<void>;           // groupForms(await listForms(...))
  fetchForm(serverId: string, name: string, version: string): Promise<void>; // request-id guarded like fetchEhrs
  // FormFieldTree: props { tree: FieldNode; selectedKey: string | null }  emits { select: [node: FieldNode] }
  // FormEnvironment: props { model: EnvironmentModel }
  // FormLayoutOutline: props { lines: OutlineLine[] }
  ```

- [ ] **Step 1: Implement the store and components**

- **FormFieldTree:** nested rows using `CaretIcon` toggles with `aria-expanded`; collapsed below depth 2. Each row shows the label, `rmType` and badges. Badges are rendered as text chips: `hidden`, `read-only`, `required`, `label overridden`, `code list <value>`, `remote <value>`. Rows are focusable buttons that emit `select`; the selected row is highlighted with `--color-bg-tertiary`.
- **FormEnvironment:** the variables table, then one block per API with its calls table. Each call's sample response sits in a `CollapsibleSection` with `JsonViewer`.
- **FormLayoutOutline:** indented lines in `--font-mono`.

- [ ] **Step 2: Write stories**

- FormFieldTree: `Default`, built from a trimmed real Anamnesis description with hidden, code-list and remote nodes, and `SelectedNode`.
- FormEnvironment: `ZoricaTerminologies` and `Empty`.
- FormLayoutOutline: `Default`.

- [ ] **Step 3: Verify**

Run: `npx vue-tsc --noEmit && npm run lint && npm run fmt:check && npx vitest run && npm run build-storybook`
Expected: all pass; the new stories appear in `storybook-static/index.json`.

- [ ] **Step 4: Commit**

```bash
git add src/stores/form.ts src/components/FormFieldTree.vue src/components/FormFieldTree.stories.ts src/components/FormEnvironment.vue src/components/FormEnvironment.stories.ts src/components/FormLayoutOutline.vue src/components/FormLayoutOutline.stories.ts
git commit -m "feat(forms): form store and field tree, environment and layout components"
```

---

### Task 5: Forms view, routing, sidebar, analytics

**Files:**
- Create: `src/views/FormBrowser.vue`
- Modify: `src/main.ts` (routes), `src/lib/navShortcuts.ts` (`{ path: "/forms", label: "Forms", icon: "F" }` after Templates), `src/composables/useAnalytics.ts` (`"forms_viewed"` under a `// --- forms ---` comment), `docs/adr/ADR-0018-aptabase-opt-in-usage-analytics.md` (event list), `src/lib/whats-new.ts` (highlight), `docs/prd/PRD-0020-forms-browser.md` (`Status: Implemented`)
- Test: `src/lib/navShortcuts.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.

- [ ] **Step 1: Write the failing test** in `navShortcuts.test.ts`:

```ts
it("places Forms directly after Templates", () => {
  const paths = navItems.map((i) => i.path);
  expect(paths.indexOf("/forms")).toBe(paths.indexOf("/templates") + 1);
  expect(pathForShortcutKey("4")).toBe("/forms");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/navShortcuts.test.ts`
Expected: FAIL (`indexOf("/forms")` is -1).

- [ ] **Step 3: Add the nav item and routes**

Both routes use `component: () => import("./views/FormBrowser.vue")` with `props: true` on `form-detail`.

- [ ] **Step 4: Implement `FormBrowser.vue`**

- **Layout:** two panes styled like `TemplateBrowser.vue` (`panel-left` list / right detail).
- **Non-Better:** when `serverStore.activeServer?.server_type !== "better_platform"`, show the empty state "Forms are a Better Platform feature", with a `router-link` to `/servers` and the current type named.
- **Left pane:** a filter input, type chips (`typeChips`; clicking the active chip clears it), and rows (`filterGroups`) showing name, `templateId`, latest version, type labels, and "N versions" when N > 1. Selecting a row routes to `form-detail` with the latest version. A refresh button calls `fetchForms`. The list loads on the active server change.
- **Right pane** (when the route has name and version):
  - `fetchForm` on route change, tracking `forms_viewed` once per opened version
  - **Header:** the name; a `<select>` of `group.versions` with "(latest)" on the first, which routes to the chosen version; the template as a `router-link` to `template-detail`; type labels; `status`; `creator`; `_username` when present; `created_timestamp`; `_revision_comment` when present
  - **Sections** as `CollapsibleSection`s, in order:
    - **Overview** (closed): a key/value table of every `FormSummary` field, every tag, and `href`
    - **Fields** (open): a language switch from `formLanguages`, starting on the description's `defaultLanguage`, then `FormFieldTree`. Selecting a node shows a details block with `formId`, `aqlPath`, `nodeId`, `min`/`max`, and `JsonViewer` of `raw`.
    - **Environment** (closed): `FormEnvironment`
    - **Layout** (closed): `FormLayoutOutline`
    - **Raw JSON** (closed): one `CollapsibleSection` per resource, either "empty" or a `JsonViewer` with a `CopyButton`
  - **Errors:** `listError` and `formError` are shown with `DismissibleError` or the view's error style.
- **What's New:** add to the existing top entry if its version is unreleased, otherwise a new `0.11.0` entry. Title "Browse Better forms"; description "A new Forms section lists a Better Platform server's forms and shows everything in a form definition: versions, fields with their code lists and visibility, the form's external APIs, its layout and the raw JSON."

- [ ] **Step 5: Full verification**

Run: `npx vue-tsc --noEmit && npm run lint && npm run fmt:check && npx vitest run && npm run build-storybook && (cd src-tauri && cargo fmt -- --check && cargo clippy -- -D warnings && cargo test)`
Expected: all pass (incl. `navShortcuts.test.ts`, `caret-glyphs.test.ts`, `whats-new.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/views/FormBrowser.vue src/main.ts src/lib/navShortcuts.ts src/lib/navShortcuts.test.ts src/composables/useAnalytics.ts docs/adr/ADR-0018-aptabase-opt-in-usage-analytics.md src/lib/whats-new.ts docs/prd/PRD-0020-forms-browser.md
git commit -m "feat(forms): add Forms browser view after Templates"
```
