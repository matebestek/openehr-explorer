# PRD-0021: Views Browser (Better Platform Views)

Version: 1.0
Date: 2026-10-17
Status: Implemented
Owner: openEHR Explorer
Repo slug: openehr-explorer
Depends on: PRD-0020 (Forms browser; same section pattern and the Better-only rule)

## Executive Summary

Add a **Views** section directly after **Forms**, showing every Better Platform *view* (a stored, server-side query pipeline) and all the information in its definition:
- name, category and description
- the declared parameters
- each processing step with its code: AQL, FreeMarker or JavaScript
- the raw JSON

A `jsonAql` step can be opened in the AQL Runner.

## Problem

Better views encapsulate the queries a portal runs, e.g. "Anamnesis - Load last for patient" or "Get HPV reports". Today the only way to read them is the Better admin console (`/ehr/adminconsole/views`), a separate, server-rendered UI. There, a definition is only visible by downloading its JSON.

## Data Source (verified on the user's CDR, 2026-10-17)

Better has **no REST endpoint for views** on this server: `/ehr/rest/v1/view`, `/views` and `/query/view` all return the servlet's 404. The admin console serves them, with the same Basic credentials as the CDR (`WWW-Authenticate: Basic realm="EHR"`):

| Request | Response |
|---|---|
| `GET {base_url}/adminconsole/views?page=N` | A server-rendered HTML page (Bootstrap and jQuery, no JS API). Its table has one row per view: a `views?name=<urlencoded name>` link, the description, and the step processor names as whitespace-separated text. Pagination comes as `views?criteria=&page=N` links; the user's server has 2 pages. |
| `GET {base_url}/adminconsole/views?download=1&name=<urlencoded name>` | `text/json`: `{ name, category, description, metaData, steps: [{ processorName, processorData }] }` |
| `GET {base_url}/adminconsole/views?downloadall=1` | `application/zip`, one JSON file per view. **Not used:** it would need a zip dependency. |

On the user's server (33 views):
- `category` was always `view`.
- `metaData` is `null` or `{ parameters: [{ name, type, format?, description }] }`. Treat it as possibly a JSON string too.
- `processorName` values seen: `jsonAql` (15), `jsonFtlAql` (14), `js` (4), `ftl` (3), `demographics_v2` (1).
- `processorData` is a string: AQL, FreeMarker-templated AQL, JavaScript, FreeMarker, or config.

The other console actions (`delete=1`, `debug=…`) must **never** be called. This section is read-only.

## User Experience (decided with the user)

- **Navigation:** a **Views** item directly after **Forms** in `navItems`, always shown, so Terminology moves to Ctrl/Cmd+7 and Servers to +8. Routes `/views` (name `views`) and `/views/:name` (name `view-detail`).
- **Non-Better servers:** the same empty state as Forms ("Views are a Better Platform feature", with a link to Server Manager).
- **Left pane:** every view (all pages merged), sorted by name case-insensitively. Each row shows the name, the description and the step processor names. A text filter covers name and description, and there's a refresh button.
- **Right pane** for the selected view:
  - **Header:** name, category, description.
  - **Parameters:** a table of name, type, format and description, or "No parameters declared".
  - **Steps:** one block per step, numbered, with its processor name and code. Code from `jsonAql` and `jsonFtlAql` steps is shown in the read-only AQL editor (`AqlEditor`, `readOnly`); everything else as monospaced preformatted text. Each step has a copy button. `jsonAql` steps get **Open in AQL Runner**, which puts the query into the AQL Runner's editor (the query store's `queryText`) and navigates to `/aql`.
  - **Raw JSON:** a collapsible `JsonViewer` in a bounded box, with a copy button.

## Non-goals

- Running, editing, creating, deleting or debugging views.
- Using `downloadall` (zip).
- "Open in AQL Runner" for `jsonFtlAql`: its FreeMarker directives aren't valid AQL.

## Architecture

**Backend:** a new `src-tauri/src/commands/view.rs`:
- `list_views(server_id) -> Vec<ViewSummary { name, description, steps: Vec<String> }>` fetches page 1, reads the highest page number from its links, and fetches the rest.
- `get_view(server_id, name) -> ViewDefinition { name, category, description, parameters: Vec<ViewParameter { name, type, format, description }>, steps: Vec<ViewStep { processor_name, processor_data }>, raw }`.

Both are Better-only (reusing `form.rs`'s `ensure_better`), send the CDR credentials, and go through `send_instrumented`. HTML is parsed with plain string scanning, which needs no new dependencies.

**Frontend:**
- `src/lib/views.ts`: types, `invoke` wrappers, `filterViews`, `isAqlStep`, `canOpenInAqlRunner`.
- `src/stores/view.ts`
- `src/components/ViewStepList.vue` with stories
- `src/views/ViewBrowser.vue`

**Analytics:** `views_viewed` (no properties) when a view is opened, plus an ADR-0018 row and a What's New highlight.

## Edge Cases

- View names with spaces, `-` and non-ASCII letters, in both the admin-console query string and the route parameter.
- HTML entities in names and descriptions (`&amp;`, `&lt;`, `&quot;`, `&#39;`).
- A view with no steps; `metaData` as `null`, an object, or a JSON string; a parameter without `format`.
- The console page returning the login page or a 401: show the error.
- Very long JavaScript or FreeMarker steps: a scrollable, bounded code block.

## Success Criteria

On the user's CDR:
- Views lists all 33 views from both pages.
- Opening **Anamnesis - Load last for patient** shows its one `jsonAql` step, with the AQL highlighted and "Open in AQL Runner".
- A view with parameters, e.g. one of the Laboratory - Cytology views, lists them.
- Raw JSON matches the console's download.
