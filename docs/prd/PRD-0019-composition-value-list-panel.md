# PRD-0019: Value List Panel for Coded Values in the Composition Viewer

Version: 1.0
Date: 2026-10-16
Status: Implemented
Owner: openEHR Explorer
Repo slug: openehr-explorer
Depends on: Web Template fetch (incl. Better Platform fallback in `get_web_template`), terminology server settings (`expand_valueset`, `describe_code`)

## Executive Summary

When reading a composition, clicking a coded value (e.g. *Overall status: Former smoker*) opens a side panel showing that value **within the whole value list** the template allows for that field: every option with its code, label and description, the recorded option highlighted, in every language the template carries, plus scores (ordinals) and term bindings where present. For fields bound to an external terminology (SNOMED CT etc.), the list comes from the configured FHIR terminology server when the template names a value set.

## Problem Statement

**Current state:** The Pretty view (`CompositionTree.vue`) shows a coded value as its recorded label and, for external terminologies, a lazily resolved display term with a terminology badge. Template-local codes (e.g. `A06_smoking` code `2`) show only the recorded text.

**Pain point:** A recorded `2` / "Former smoker" says nothing about what else the clinician could have chosen, what each code means, or how the value list reads in the template's other language. Finding that today means leaving the composition, opening the Template Browser, and hunting for the field by hand.

**Who:** developers and modellers inspecting real compositions on a CDR (first seen on a Better Platform CDR with Slovenian/English templates using local code lists like `A06_smoking`).

## Goals

- Click a coded value in the Pretty view → see the full value list in context, recorded option highlighted, without leaving the composition.
- Show everything the template provides for the field ("whatever is available").
- Cover external-terminology fields via the FHIR terminology server where possible.

## Non-goals

- Editing values (the composition form is the editing surface).
- Showing value lists for non-coded values (text, quantities, dates) — they are not clickable.
- Browsing terminologies independently of a composition (the Template Browser / terminology tools already do that).

## Anti-goals (would make this a failure even if it technically works)

- Leaving the composition: the panel must not navigate away or cover the composition (a modal was explicitly rejected in favour of a side panel).
- Showing a list that silently belongs to the wrong field (e.g. matching an `at0004` from a different archetype). If the field can't be matched confidently, say so rather than guess.
- Blocking or slowing the Pretty view: no per-value network requests on render; external lookups only on click.

## User Experience (decided with the user)

Layout: **side panel on the right** of the composition (mockup option B). The composition stays visible.

- In the Pretty view, `DV_CODED_TEXT` and `DV_ORDINAL` values are clickable (pointer cursor, focusable, Enter/Space activates). Plain `DV_TEXT` and non-coded values are not.
- Clicking opens the panel; clicking another coded value updates it in place; ✕ (and Escape) closes it.
- The panel and the existing FLAT Paths panel share the right side: **only one is open at a time** (opening one closes the other).
- Panel contents, top to bottom:
  1. Field name and description (from the template, in the selected language).
  2. Terminology id (`A06_smoking`, `local`, `SNOMED-CT`, …) and RM type; template id.
  3. Language switch listing every language the template carries; **defaults to the composition's language** (`language.code_string`), falling back to the template's default language.
  4. The value list: one row per option with code, label, description; **ordinals also show their score**. The recorded option is highlighted and scrolled into view.
  5. Term bindings for the field / its codes, when the template has them.
  6. Annotations, if the template has them for the field.
- **External terminology fields:**
  - If the template names a value set, expand it via the terminology server (`expand_valueset`) on click and show it in the same list format, recorded code highlighted.
  - If no value set is named, or expansion fails / no terminology server is configured, show the recorded code with its description from the terminology server (`describe_code`) when available, plus a short note saying why the full list isn't shown (no value set in template / server error with message / no server configured).
- If the Web Template isn't loaded, or the clicked value can't be matched to a template field, the panel says so plainly (with the reason) instead of showing a guessed list.

## Data Sources

Everything except external lists comes from the **Web Template** `CompositionViewer.vue` already loads (`get_web_template`, incl. the Better `/rest/v1/template/{id}` fallback). No new backend call for local lists.

Relevant Web Template node fields (names as in the Web Template JSON; treat all as optional):

- `name`, `localizedName`, `localizedNames`, `localizedDescriptions`, `rmType`, `nodeId`, `aqlPath`, `annotations`, `termBindings`
- `inputs[]` — the code input (`suffix === "code"` or no suffix) carries `list[]` (`value`, `label`, `localizedLabels`, `localizedDescriptions`, `ordinal` for `DV_ORDINAL`, optional `termBindings`), `terminology`, `listOpen`
- `languages` / `defaultLanguage` at the Web Template root

External lists: existing `expand_valueset` / `describe_code` Tauri commands against the effective terminology server.

## Matching a Composition Value to Its Template Field

Build an AQL-style path for each node while `CompositionTree.vue` builds its tree from the canonical composition, accumulating `/<attribute>[<archetype_node_id>]` segments (e.g. `/content[openEHR-EHR-OBSERVATION.x.v1]/data[at0001]/events[at0002]/data[at0003]/items[at0004]/value`). Match it against Web Template node `aqlPath`s after stripping name predicates (`[at0004,'Name']` → `[at0004]`).

- Exactly one match → use it.
- Several matches (same archetype path, distinguished only by name) → disambiguate by the composition node's `name/value` against the template node's `localizedNames`/`name`.
- No match → "field not found in template" state (anti-goal: don't fall back to a global `nodeId` search like `resolveNodeLabel` does).

The Web Template represents an ELEMENT and its value as one node whose `aqlPath` ends in `/value`, so the clicked value's path (ELEMENT path + `/value`) is the one to match.

## Architecture Sketch

- `src/lib/webtemplate.ts`: pure helpers — `findNodeByAqlPath(webTemplate, path, name?)`, `stripNamePredicates(path)`, `extractValueList(node, language)` returning a normalised view model (field info, options[], bindings, annotations, terminology, value-set URL if any). Unit-tested with Vitest.
- `src/components/ValueListPanel.vue` (+ `ValueListPanel.stories.ts`, per ADR-0021): presentational panel taking the view model, recorded code, languages, and loading/error state; emits `close` and language change. Styling via theme tokens (`src/styles/tokens.css`); no opacity dimming (ADR-0028); carets via `CaretIcon` if any disclosure is used.
- `CompositionTree.vue`: compute the AQL-style path per node; make coded values clickable and emit `select-coded-value` with path, name, RM type, code, terminology, label.
- `CompositionViewer.vue`: own the selected value and panel state; enforce one-right-panel-at-a-time with the FLAT Paths panel; on selection resolve the template node, and for external fields call `expandValueSet` / `describeCode`.

## Edge Cases

- Composition in a language the template doesn't carry → default to the template's default language.
- Recorded code not in the list (open list / `listOpen`, or data drift) → show the list, plus the recorded value pinned at the top marked "recorded — not in template list".
- Very long lists (external expansions) → cap rows rendered (e.g. first 200 plus a count), with the recorded code always shown.
- Composition without a Web Template (fetch failed) → panel explains, still shows the recorded code/terminology/label from the composition.
- Repeated value elements (`items[at0004]` occurring several times) all match the same template field — that's correct; each click highlights its own recorded code.

## Success Criteria

- On the user's Better CDR, clicking *Overall status* in an Anamnesis composition shows all `A06_smoking` options in Slovenian and English with the recorded one highlighted.
- Clicking a SNOMED-bound field with a value set expands the list via the terminology server; without one, the note explains why.
- Vitest coverage for path matching (incl. name disambiguation and no-match) and list extraction (local, ordinal, external, missing localisation); Storybook stories for panel states (local list, ordinal, external expanded, external unavailable, not matched); `npm run test:a11y` passes.

## Settled Without the User (planner's calls)

- Pretty view only; the JSON and FLAT tabs are unchanged.
- `DV_ORDINAL` values are clickable too (their `symbol.defining_code` is matched like a coded text's code).
- The selected language is not persisted between compositions; it resets to the composition's language each time.
- No new analytics events; add a "What's New" highlight for the release that ships it (PRD-0018), no new tour step.

## Left to the Builder

- Exact visual design within the side-panel layout, panel width/resizing, and how bindings/annotations are laid out.
- Whether the AQL-style path is computed in `buildTree` or lazily on click.
- How to detect a value-set URL in a Web Template code input (Better and EHRBase encode it differently; support what can be verified, show the "no value set" note otherwise).

## Amendment (2026-10-17): code-list services and two click targets

Found on the user's Better CDR: template-local code systems such as `A06_smoking` are enumerated in **neither** the Web Template (the field has no `inputs`) **nor** the OPT (an empty `C_CODE_REFERENCE`). Better forms load them at runtime from a deployment-specific terminology adapter (form environment → external API "Zorica Terminologies"), which needs no login:

- `GET {base}/codesystem/{id}` → metadata incl. `languages`
- `GET {base}/codesystem/{id}/entities?pagesize=N&language=xx` → `{ items: [{ code, description, user_code }], lastPage }`

Changes, decided with the user:

- **Server profile:** optional **Code-list service URL** (`code_list_url`), e.g. `https://zzora-test.ss.ezdrav.si/terminology-adapter/rest/terminology`. Backend command `get_code_list` (src-tauri/src/commands/code_list.rs); CDR credentials are never sent to it.
- **Lookup order** for a field without a template list: terminology ids that aren't a standard FHIR terminology, a URI, `local` or `openehr` go to the code-list service; everything else keeps the FHIR `$expand` / `$lookup` path. The list shows each code's description and user code; the language switch uses the code system's own languages and re-fetches.
- **Two click targets** (replaces "clicking a coded value opens the list"):
  - Clicking the **terminology badge** (e.g. `A06_SMOKING`) opens the panel with the **full value list**, recorded code highlighted.
  - Clicking the **value** opens the panel with **only the recorded code** — label, code, user code, description, score, bindings.
- **Source shown** (2026-10-17, user request): the panel's "Source" section names where the list, or the recorded code's description, came from:
  - for a template list: `Template <id> (Web Template)`
  - for the code-list service: `Code-list service, code system <id>`, plus the exact URL fetched (`get_code_list` returns it as `source_url`, without paging)
  - for a FHIR value set expansion: the value set URL
  - for a FHIR code lookup: `FHIR terminology server, code lookup`
