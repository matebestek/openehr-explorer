# PRD-0020: Forms Browser (Better Platform Forms)

Version: 1.0
Date: 2026-10-17
Status: Implemented
Owner: openEHR Explorer
Repo slug: openehr-explorer
Depends on: Server profiles with `server_type: "better_platform"` and Better's native API under `{base_url}/rest/v1` (as already used by the Web Template / FLAT fallbacks)

## Executive Summary

Add a **Forms** section, a new top-level category directly after **Templates**, that shows everything in a Better Platform form definition. It has a form list on the left. On the right is the selected form, with a version picker, a header of key facts, and collapsible sections for Overview, Fields, Environment, Layout and Raw JSON.

This is **project 1 of 3**, agreed with the user:
1. **Forms list and detail viewer** (this PRD)
2. **Links:** form field → template node, form field → code list in Terminology, and template → forms that use it
3. **Version comparison:** diff two versions of a form

## Problem Statement

Better forms carry information that exists nowhere else: which code list a field uses (e.g. `A02_anamnesis_source`), field visibility and labels, and the external APIs the form calls at runtime (e.g. "Zorica Terminologies" with its `terminologyUrl` variable). Finding the source of `A06_smoking` (PRD-0019 amendment) meant hand-written `curl` calls against `/rest/v1/form` and reading 60 KB of JSON. The app has no way to see forms at all.

**Who:** developers and modellers working against Better CDRs. The motivating deployment is a Better CDR with 255 form entries.

## Goals

- Browse all forms on a Better server and see **all information in a form definition**, readably, without leaving the app.
- Make form versions visible and selectable.
- Keep the raw definition one click away for anything the structured views don't cover.

## Non-goals (project 1)

- Editing, creating, publishing or deleting forms.
- Rendering or running a form, e.g. filling it in to create a composition.
- Cross-links to templates and code lists, and "used by forms" on templates (project 2).
- Version comparison (project 3).
- Form support for non-Better servers. EHRBase, FerroEHR and generic CDRs have no forms API.

## Anti-goals

- **Misleading or partial data:** hiding parts of a definition the structured view doesn't understand, or showing a guessed interpretation as fact. Anything not modelled must still be visible, at minimum in Raw JSON.
- **Slowness:** loading every form's resources up front. A server can have hundreds of form entries.

## Better Form API (verified on the user's CDR, 2026-10-17)

All calls go to `{base_url}/rest/v1` with the profile's CDR credentials. With `base_url = https://cdr.example.com/ehr`, the base is `/ehr/rest/v1`.

| Request | Response |
|---|---|
| `GET /form` | `{ forms: [ { templateId, name, version, createdTimestamp, status, category, creator, type, schemaVersion, tags } ] }`. Lists **every version as a separate entry**, so 255 entries cover far fewer distinct names, e.g. "P-Status nepregledanih vzorcev" appears 76 times. |
| `GET /form?name=X` | the same shape, filtered by name |
| `GET /form/{name}` | `{ meta: { href }, form: { …the same fields…, resources: [ { name, mimetype, type, href, content } ] } }` for the **latest** version. `content` is `null` unless requested. |
| `GET /form/{name}/{version}?resources=a,b,…` | the same, for that version, with `content` filled in for the named resources. `resources=*` is rejected with 404. Naming a resource the form **doesn't have** also fails the whole request, with 404 `FORM-5721`; this is common, since many forms lack some of the seven resources. So `get_form` first fetches without `resources` to list what the form has, then asks for exactly those. |
| `GET /form/{name}/versions` | 400: "Form version needs to be of the form 1.0.4". There is no versions endpoint; versions come from grouping `GET /form`. |

**Resource names** seen: `app-pages`, `widget-configuration`, `form-metadata`, `form-environment`, `templates` (`text/plain`), `form-layout`, `form-description`. In the Anamnesis form, only `form-description` (about 49 KB), `form-layout` and `form-environment` had content.

**Tags:**
- `_form_labels`: the form type. It can be comma-separated, e.g. `Gineko Portal,CLINICAL FORM`, and 188 of 255 entries have none.
- `_username`: the last editor.
- `_revision_comment`
- `UserForm`, plus free-form others

Seen values: `status` was always `active`, `category` always `default`, `type` always `JSON`.

**form-description:** a Web-Template-like tree. Each node has `id`, `formId` (e.g. `anamnesis/tobacco_smoking_summary/overall_status`), `name`, `localizedName(s)`, `localizedDescriptions`, `rmType`, `nodeId`, `aqlPath`, `min`/`max`, `children`, `inputs[]` (with `terminology`, `list`, `suffix`, `type`) and `viewConfig`. `viewConfig` holds `advanced.hidden`, `advanced.overrideLabel`, `size`, `layout`, `field.*`, `datasource` (`loadRemote`, `loadRemoteUrl`, `terminology`, `parameters`), `tags` and `annotations`. The root also has `templateId`, `defaultLanguage`, `defaultTerminology`, `fbVersion` and `uuid`.

**form-environment:**
- `variables[]`: `id`, `name`, `type`, `source` (e.g. `EXTERNALLY_PROVIDED`), `mandatory`, `value`
- `externalApis[]`: `name`, `authentication`, `headers`, `parameters`, and `calls[]`. Each call has `name`, `requestMethod`, `url` (often a variable name such as `terminologyUrl`), `pathParams`, `parameters`, `headers`, `bodyType`, `sampleResponse` and `response` (a field schema).

**form-layout:** a grid of `{ col, row, width, height, children: [ { id, rows: [ { cols: [ { width, children } ] } ] } ] }`, referring to fields by `formId`.

## User Experience (decided with the user)

**Navigation:**
- A **Forms** item in the sidebar, directly after **Templates** (`src/lib/navShortcuts.ts` `navItems`).
- Routes `/forms` and `/forms/:name/:version`, with a `forms` / `form-detail` pair like `templates` / `template-detail`.

**Layout:** two panes, like the Template Browser.

**Left pane: the forms list**
- One row per form **name**, built by grouping `GET /form`. Each row shows the latest version, its `templateId`, its type labels, and "N versions" when N > 1.
- A text filter over name and template.
- Type chips built from the `_form_labels` values present (split on commas), plus "No type".
- Sorted by name, alphabetically and case-insensitively.
- Loaded once per server and refreshable, like other lists.

**Right pane: the selected form** (option B, one scrolling page with collapsible sections)
- **Header** (always visible):
  - the form name, and a **version picker** listing that name's versions, newest first, latest marked
  - the template id, which links to `/templates/:templateId`
  - type labels and status
  - `creator`, plus the last editor (`_username`) when present
  - `createdTimestamp`
  - the `_revision_comment` when present
- **Overview** (collapsed): every top-level attribute and every tag as a key/value table, plus `meta.href`.
- **Fields** (open by default): the `form-description` tree, using `CollapsibleSection` and `CaretIcon` for nesting.
  - Each node shows its label in the selected language (`localizedNames[lang]`, falling back to `name`), its `rmType`, and badges for: **hidden** (`viewConfig.advanced.hidden`), **read-only** (`viewConfig.field.*.readonly` or `disabled`), **required** (`min ≥ 1`), **code list** (an input `terminology` that isn't openEHR's own), **remote data** (`viewConfig.datasource.loadRemote` and `loadRemoteUrl`), and **label overridden** (`advanced.overrideLabel`).
  - A language switch covers the languages present in the form, starting on `defaultLanguage`.
  - Selecting a node shows all its properties: `formId`, `aqlPath`, `nodeId`, occurrences, inputs and the full `viewConfig`, as structured key/values plus collapsible raw JSON.
- **Environment** (collapsed): a variables table (name, type, source, mandatory, value), then each external API with its authentication type, headers and parameters. For each call it shows the method, URL or URL variable, path parameters, query parameters, body type, and the sample response (collapsible JSON).
- **Layout** (collapsed): the grid as an indented outline of rows and columns with widths, listing the field `id`s it places.
- **Raw JSON** (collapsed): each of the resources with a copy button, empty ones marked "empty". Uses the existing virtualised `JsonViewer`.

**Non-Better servers:** the Forms entry is always in the sidebar. The page shows an empty state explaining that forms are a Better Platform feature, with a link to Server Manager to check the profile's server type.

## Architecture Sketch

**Backend:** a new `src-tauri/src/commands/form.rs`, registered in `lib.rs`.
- `list_forms(server_id) -> Vec<FormSummary>` calls `GET {base_url}/rest/v1/form` and returns the entries flat. Grouping happens on the frontend, where it can be tested.
- `get_form(server_id, name, version) -> FormDefinition` calls `GET {base_url}/rest/v1/form/{name}/{version}?resources=<all seven names>`. It returns the form attributes, tags, `meta.href`, and every resource with `name`, `mimetype`, `href` and `content` (`null` when empty).
- Both reject non-Better profiles with a clear error, send the CDR credentials, and go through `send_instrumented`. URL segments are percent-encoded: names contain spaces and non-ASCII letters.

**Frontend:**
- `src/lib/forms.ts`: pure functions with Vitest tests:
  - grouping the list into names with sorted versions (semantic version order, not string order)
  - type-label extraction
  - the field-tree view model with badges
  - environment and layout outlines
- `src/stores/form.ts` (Pinia): the list per server, the selected form, loading and errors.
- `src/views/FormBrowser.vue`, plus focused components such as `FormFieldTree.vue`, `FormEnvironment.vue` and `FormLayoutOutline.vue`, each with a `.stories.ts` (ADR-0021).
- Routing in `src/main.ts`; the nav item in `src/lib/navShortcuts.ts`.

## Edge Cases

- A form name with many versions: 76 for one name on the user's server. The picker must stay usable.
- Version strings such as `1.0.157` vs `1.0.20`: sort numerically.
- Names with spaces and Slovenian letters (č, š, ž) in URLs.
- Resources with `content: null`, a non-JSON `templates` resource (`text/plain`), or a resource missing entirely.
- A form-description node without `localizedNames` for the chosen language; nodes without `viewConfig`.
- Multiple comma-separated `_form_labels`; tags absent.
- A Better server whose form API answers 401 or 403 (e.g. a user without form rights): show the error, don't hide the section.
- A large form-description (about 50 KB, hundreds of nodes): the tree renders lazily (collapsed below depth 2).

## Success Criteria

On the user's Better CDR:
- Forms lists the distinct forms with version counts.
- Opening **Anamnesis** shows version 1.0.157 with the template link, revision comment and tags.
- Fields shows the tree, with Kajenje / Smoking marked hidden and Vir anamneze showing code list `A02_anamnesis_source`.
- Environment shows the "Zorica Terminologies" API with its 9 calls.
- Raw JSON shows all 7 resources.

Checks: Vitest coverage for `src/lib/forms.ts` and Rust unit tests for URL building and response parsing; Storybook stories for the new components; `npm run test:a11y` passing.

## Settled Without the User (planner's calls)

- **Shortcuts:** the sidebar entry is static, so keyboard shortcuts stay stable. Inserting Forms after Templates shifts AQL Runner to Ctrl/Cmd+5, Terminology to +6 and Servers to +7. This follows from the requested position.
- **Raw view:** reuses `JsonViewer`; no new raw viewer.
- **Language switch:** offers the union of the language keys in `localizedNames` across the form-description tree.
- **Code list badge:** shown for an input `terminology` that is non-empty and isn't `openehr` or `local`. Its value is the code system id.
- **Tour:** no feature-tour step for Forms in project 1.
- **Language:** the field-tree language isn't persisted between forms.
- **Analytics:** one `forms_viewed` event when a form is opened, no properties, like other "viewed" events (ADR-0018 enums only). Plus a What's New entry for the release that ships it.

## Decided by the user after review

- **Sidebar on non-Better servers:** Forms is **always shown**. On a non-Better server, the Forms page explains that forms are a Better Platform feature. This keeps the Ctrl/Cmd+number shortcuts fixed whatever server is active.

## Left to the Builder

- Exact visual design within the agreed layout, badge styling, and section icons.
- Whether the field tree and the selected-node details sit side by side or the details expand inline.
- How the layout outline is drawn, as long as rows, columns, widths and field ids are readable.
