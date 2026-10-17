# Views Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Views** section after Forms that lists a Better server's views (from the admin console) and shows each view's parameters, steps (with code) and raw JSON. `jsonAql` steps can be opened in the AQL Runner.

**Architecture:**
- `src-tauri/src/commands/view.rs` reads the admin console's view list (HTML, paged) and per-view JSON downloads, with pure, unit-tested parsers.
- `src/lib/views.ts` holds the types and pure helpers.
- A store, a `ViewStepList` component and `ViewBrowser.vue` mirror the Forms browser.

**Tech Stack:** Rust (reqwest, serde_json, urlencoding), Vue 3 + TS, Pinia, Vitest, Storybook.

**Spec:** `docs/prd/PRD-0021-views-browser.md`

## Global Constraints

- **Dependencies:** no new ones (no HTML or zip crate).
- **Read-only:** never call the console's `delete=1` or `debug=` actions; only `views?page=N` and `views?download=1&name=…`.
- **Better only,** reusing `form::ensure_better` (made `pub(crate)`). Requests use the CDR auth via `make_request` + `send_instrumented`.
- **Sidebar order:** …, Templates, Forms, **Views**, AQL Runner, Terminology, Servers.
- **Routes:** `/views` (`views`) and `/views/:name` (`view-detail`).
- **Analytics:** `views_viewed` with no properties, plus an ADR-0018 row and a What's New highlight in the unreleased 0.11.0 entry.
- **Conventions:** tokens only, no opacity dimming (ADR-0028); stories for new components (ADR-0021); `CaretIcon`/`CollapsibleSection` for disclosure; `JsonViewer` inside a bounded flex box (see `src/views/form-layout.test.ts`).
- **Commits:** Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Names with spaces, `-` and `č/š/ž`** must round-trip from the list link to `download=1&name=…`. Pinned in Task 1.
- **HTML entities** in names and descriptions are unescaped. Pinned in Task 1.
- **`metaData`** as `null`, an object or a JSON string, and a parameter without `format`. Pinned in Task 1.
- **A login page or HTML** returned instead of view JSON gives a readable error, not a panic. Pinned in Task 1.
- **The Views page's JsonViewer box** is a bounded flex column. Pinned in Task 3 via a layout test like `form-layout.test.ts`.

---

### Task 1: Backend view commands

**Files:** create `src-tauri/src/commands/view.rs`. Modify `commands/mod.rs`, `lib.rs` (register `view::list_views`, `view::get_view`), and `commands/form.rs` (`pub(crate) fn ensure_better`; give its message a subject parameter, or add a `views` wrapper — see Step 3).

**Interfaces (Produces, snake_case over IPC):**
```rust
pub struct ViewSummary { pub name: String, pub description: Option<String>, pub steps: Vec<String> }
pub struct ViewParameter { pub name: String, pub param_type: Option<String> /* "type" */, pub format: Option<String>, pub description: Option<String> }
pub struct ViewStep { pub processor_name: String, pub processor_data: String }
pub struct ViewDefinition { pub name: String, pub category: Option<String>, pub description: Option<String>,
    pub parameters: Vec<ViewParameter>, pub steps: Vec<ViewStep>, pub raw: serde_json::Value }
#[tauri::command] pub async fn list_views(app, server_id: String) -> Result<Vec<ViewSummary>, String>;
#[tauri::command] pub async fn get_view(app, server_id: String, name: String) -> Result<ViewDefinition, String>;
```

- [ ] **Step 1: Failing tests**
  - `views_page_url(base, 2)` → `{base}/adminconsole/views?criteria=&page=2`
  - `view_download_url(base, "Get HPV reports")` → `…/adminconsole/views?download=1&name=Get%20HPV%20reports`, with `č` percent-encoded
  - `parse_views_page(html)` on a fixture of two real-shaped rows (one name `Laboratory - Cytology - Load cytology summary`, one with `&amp;` in the description) → names, descriptions and `steps == ["jsonAql"]`, plus `max_page == 2` from the `page=2` link
  - an empty table → no views and `max_page == 1`
  - `parse_view_definition` covers `metaData` as `null`, an object and a JSON string; a parameter without `format`; `raw` kept intact; and an error (not a panic) for `<!doctype html>`

- [ ] **Step 2: Run** `cd src-tauri && cargo test view::`. Expected: compile errors.

- [ ] **Step 3: Implement.**
  - Parse rows by scanning each `views?name=` anchor. The name comes from the URL-decoded `href` value, falling back to the HTML-unescaped anchor text. The next `<td>` is the description (tags stripped, unescaped, trimmed, empty → `None`); the `<td>` after it is the steps, split on whitespace.
  - `max_page` is the largest `page=N` in any href (default 1). `list_views` fetches page 1, then pages 2..=max, de-duplicates by name and sorts case-insensitively.
  - `ensure_better` takes the subject: `"Forms are a Better Platform feature…"` / `"Views are a Better Platform feature…"`. Keep the existing forms test.

- [ ] **Step 4: Run** `cargo fmt && cargo test view:: form:: && cargo clippy -- -D warnings`. Expected: pass.

- [ ] **Step 5: Commit** `feat(views): read Better views from the admin console`

### Task 2: Frontend model, store and step list

**Files:** create `src/lib/views.ts`, `src/lib/views.test.ts`, `src/stores/view.ts`, `src/components/ViewStepList.vue` and `.stories.ts`.

**Interfaces:**
```ts
export interface ViewSummary { name: string; description: string | null; steps: string[] }
export interface ViewParameter { name: string; param_type: string | null; format: string | null; description: string | null }
export interface ViewStep { processor_name: string; processor_data: string }
export interface ViewDefinition { name: string; category: string | null; description: string | null; parameters: ViewParameter[]; steps: ViewStep[]; raw: unknown }
export function listViews(serverId: string): Promise<ViewSummary[]>;
export function getView(serverId: string, name: string): Promise<ViewDefinition>;
export function filterViews(views: ViewSummary[], text: string): ViewSummary[]; // name or description, case-insensitive
export function isAqlStep(step: ViewStep): boolean;            // jsonAql | jsonFtlAql
export function canOpenInAqlRunner(step: ViewStep): boolean;   // jsonAql only
// useViewStore: views, listLoading, listError, selected, viewLoading, viewError, fetchViews, fetchView, clear (request-id guarded)
// ViewStepList: props { steps: ViewStep[] }  emits { "open-in-aql": [aql: string] }
```

- [ ] **Step 1: Failing tests** for `filterViews` (by name, by description, empty text), `isAqlStep` and `canOpenInAqlRunner` (`jsonAql` true/true, `jsonFtlAql` true/false, `js` false/false).
- [ ] **Step 2: Run** `npx vitest run src/lib/views.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `views.ts` and the store (same pattern as `src/stores/form.ts`).
- [ ] **Step 4: Implement `ViewStepList`.** Each step block has a number, `processor_name` and a `CopyButton`. AQL steps render in `AqlEditor` with `readOnly`, others in a `<pre>` with `max-height: 360px; overflow: auto`. `jsonAql` steps also get an "Open in AQL Runner" button that emits `open-in-aql`. Stories: `AqlStep`, `MixedSteps` (jsonFtlAql + js + ftl), `NoSteps`.
- [ ] **Step 5: Verify** `npx vitest run && npx vue-tsc --noEmit && npm run lint && npm run fmt:check && npm run build-storybook`. Expected: pass.
- [ ] **Step 6: Commit** `feat(views): view model, store and step list`

### Task 3: Views page, routing, sidebar, analytics

**Files:** create `src/views/ViewBrowser.vue` and `src/views/view-layout.test.ts`. Modify `src/main.ts`, `src/lib/navShortcuts.ts` (+ test), `src/composables/useAnalytics.ts`, `docs/adr/ADR-0018-…md`, `src/lib/whats-new.ts`, and `docs/prd/PRD-0021-views-browser.md` (`Status: Implemented`).

- [ ] **Step 1: Failing tests**
  - `navShortcuts.test.ts`: "places Views directly after Forms"; `pathForShortcutKey("5") === "/views"`.
  - `view-layout.test.ts`: `ViewBrowser.vue`'s `.json-box` rule has a px height, `display: flex`, `flex-direction: column` and `overflow: hidden`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The nav item `{ path: "/views", label: "Views", icon: "W" }` and the routes (`props: true` on `view-detail`).
  - `ViewBrowser.vue`, mirroring `FormBrowser.vue`:
    - a non-Better empty state
    - the left list with filter and refresh
    - the server-switch reset using `returnToListOnServerChange` from `src/lib/forms.ts`
    - the right pane: header, Parameters table, `ViewStepList` (with `@open-in-aql` setting `useQueryStore().queryText` and pushing `/aql`), and a Raw JSON `CollapsibleSection` with a bounded `JsonViewer` and `CopyButton`
    - `views_viewed` tracked in the open handler
  - Analytics event, ADR row, What's New highlight ("Browse Better views": "A new Views section shows the views stored on a Better Platform server: their parameters, every processing step with its AQL, FreeMarker or JavaScript code, and the raw definition. AQL steps open in the AQL Runner."), and the PRD status.
- [ ] **Step 4: Full verification** `npx vue-tsc --noEmit && npm run lint && npm run fmt:check && npx vitest run && npm run build-storybook && (cd src-tauri && cargo fmt -- --check && cargo clippy -- -D warnings && cargo test)`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(views): add Views browser after Forms`
