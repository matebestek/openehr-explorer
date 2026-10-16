# Composition Value List Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a coded value in the Composition Viewer's Pretty view opens a right-side panel showing that value within the full value list from the template (or from the FHIR terminology server for external fields), recorded option highlighted.

**Architecture:** All decision logic lives in a new pure module `src/lib/valueList.ts` (path matching, list extraction, panel-state resolution, external loading with injectable deps), unit-tested with Vitest in the existing `node` environment. `ValueListPanel.vue` is presentational and covered by Storybook stories + the axe contrast gate. `CompositionTree.vue` computes an AQL-style path per node and reports clicks; `CompositionViewer.vue` owns selection state and the one-right-panel-at-a-time rule.

**Tech Stack:** Vue 3 (`<script setup>` + the existing render-function `TreeNodeComponent`), TypeScript, Vitest 4 (node env, no component test utils), Storybook (`@storybook/vue3-vite`), Tauri `invoke` via `src/lib/terminology.ts`.

**Spec:** `docs/prd/PRD-0019-composition-value-list-panel.md`

## Global Constraints

- Pinned dependency versions; this plan adds **no** new dependencies.
- Theme colours only via tokens in `src/styles/tokens.css`; never dim text with `opacity` — use `--color-text-secondary` / `--color-text-muted` (ADR-0028).
- Never draw carets with text glyphs; use `CaretIcon.vue` (enforced by `caret-glyphs.test.ts`).
- Every new component gets a sibling `*.stories.ts` (ADR-0021).
- Pretty view only; JSON / FLAT tabs unchanged.
- Clickable: `DV_CODED_TEXT` and `DV_ORDINAL` values only.
- Only one right-side panel open at a time (FLAT Paths **or** Value List).
- Language defaults to the composition's `language.code_string`, else the template's `defaultLanguage`; not persisted.
- No per-value network requests on render; external lookups only on click.
- Never guess a field: no global `nodeId` fallback like `resolveNodeLabel`.
- Render at most 200 option rows; the recorded code is always shown.
- No new analytics events.
- Commits follow Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Two sibling template nodes with the same archetype path, distinguished only by name (e.g. two `items[at0004]` renamed in the template) — must resolve by the composition element's name, or report "ambiguous", never pick the first. Pinned in Task 1.
- Recorded code missing from the template list (open list / data drift) — shown pinned at the top as "recorded — not in template list", never silently absent. Pinned in Task 2.
- Template without a translation for the selected language — labels fall back to the default `label`, descriptions to `null`; never blank rows. Pinned in Task 2.
- External field with no terminology server configured or a failing `$expand` — panel shows the recorded code plus the error reason, not a spinner forever or an empty list. Pinned in Task 3.
- Web Template failed to load — panel still shows the recorded code/label/terminology with a "template not loaded" reason. Pinned in Task 3.

---

### Task 1: Path matching and recorded-code extraction

**Files:**
- Create: `src/lib/valueList.ts`
- Test: `src/lib/valueList.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type TemplateNode = Record<string, unknown>;
  export interface RecordedCode {
    rmType: "DV_CODED_TEXT" | "DV_ORDINAL";
    terminology: string;      // defining_code.terminology_id.value
    code: string;             // defining_code.code_string
    label: string | null;     // value (coded text) / symbol.value (ordinal)
    ordinal: number | null;   // DV_ORDINAL.value, else null
  }
  export interface CodedValueSelection {
    aqlPath: string;          // AQL-style path of the clicked value node
    treePath: string;         // CompositionTree's own node path (unique per rendered value)
    elementName: string | null; // name/value of the parent ELEMENT
    recorded: RecordedCode;
  }
  export type TemplateMatch =
    | { status: "found"; node: TemplateNode }
    | { status: "not-found" }
    | { status: "ambiguous"; count: number };
  export function stripNamePredicates(path: string): string;
  export function childAqlPath(parentAqlPath: string, attribute: string, child: unknown): string;
  export function extractRecordedCode(value: Record<string, unknown>): RecordedCode | null;
  export function findTemplateNodeByAqlPath(
    webTemplate: Record<string, unknown>, aqlPath: string, elementName: string | null,
  ): TemplateMatch;
  ```

- [ ] **Step 1: Write the failing tests** in `src/lib/valueList.test.ts`:

```ts
describe("stripNamePredicates", () => {
  it("drops name predicates but keeps node ids", () => {
    expect(stripNamePredicates("/content[openEHR-EHR-OBSERVATION.x.v1,'Smoking']/data[at0001]/items[at0004,'Status']/value"))
      .toBe("/content[openEHR-EHR-OBSERVATION.x.v1]/data[at0001]/items[at0004]/value");
  });
});

describe("childAqlPath", () => {
  it("appends the archetype node id as a predicate when the child has one", () => {
    expect(childAqlPath("", "content", { archetype_node_id: "openEHR-EHR-OBSERVATION.x.v1" }))
      .toBe("/content[openEHR-EHR-OBSERVATION.x.v1]");
    expect(childAqlPath("/content[openEHR-EHR-OBSERVATION.x.v1]", "data", { archetype_node_id: "at0001" }))
      .toBe("/content[openEHR-EHR-OBSERVATION.x.v1]/data[at0001]");
  });
  it("appends a bare attribute for children without a node id (e.g. the ELEMENT value)", () => {
    expect(childAqlPath("/items[at0004]", "value", { _type: "DV_CODED_TEXT" })).toBe("/items[at0004]/value");
  });
});

describe("extractRecordedCode", () => {
  it("reads a DV_CODED_TEXT", () => {
    expect(extractRecordedCode({ _type: "DV_CODED_TEXT", value: "Former smoker",
      defining_code: { terminology_id: { value: "A06_smoking" }, code_string: "2" } }))
      .toEqual({ rmType: "DV_CODED_TEXT", terminology: "A06_smoking", code: "2", label: "Former smoker", ordinal: null });
  });
  it("reads a DV_ORDINAL via symbol.defining_code", () => {
    expect(extractRecordedCode({ _type: "DV_ORDINAL", value: 3,
      symbol: { value: "Severe", defining_code: { terminology_id: { value: "local" }, code_string: "at0012" } } }))
      .toEqual({ rmType: "DV_ORDINAL", terminology: "local", code: "at0012", label: "Severe", ordinal: 3 });
  });
  it("returns null for DV_TEXT and for coded values without a code", () => {
    expect(extractRecordedCode({ _type: "DV_TEXT", value: "free text" })).toBeNull();
    expect(extractRecordedCode({ _type: "DV_CODED_TEXT", value: "x", defining_code: { terminology_id: { value: "local" } } })).toBeNull();
  });
});

describe("findTemplateNodeByAqlPath", () => {
  // minimal Web Template: tree with nested children, aqlPath on each node
  it("finds the node whose aqlPath (name predicates stripped) equals the path", () => { /* expect status "found", node.id === "overall_status" */ });
  it("disambiguates same-path siblings by the element name (localizedNames or name)", () => {
    // two nodes with aqlPath ".../items[at0004,'Status A']/value" and "...,'Status B']/value"
    // elementName "Status B" → found, node.id === "status_b"
  });
  it("reports ambiguous when same-path siblings can't be told apart by name", () => {
    // elementName "Something else" → { status: "ambiguous", count: 2 }
  });
  it("reports not-found rather than matching the same at-code elsewhere", () => {
    // template has items[at0004] under a different archetype only → { status: "not-found" }
  });
});
```

Fill the four `findTemplateNodeByAqlPath` tests with a small inline Web Template fixture (`{ tree: { id, aqlPath: "/", children: [...] } }`); the comments give the exact expected results.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/valueList.test.ts`
Expected: FAIL — module `./valueList` has no such exports.

- [ ] **Step 3: Implement the four functions in `src/lib/valueList.ts`**

`stripNamePredicates`: regex removing `,'…'` (and `,"…"`) inside `[...]`. `findTemplateNodeByAqlPath`: depth-first collect every node whose `stripNamePredicates(node.aqlPath)` equals `stripNamePredicates(aqlPath)`; 1 → found; >1 → keep those whose `name` or any `localizedNames` value equals `elementName` (1 → found, else ambiguous with the original count); 0 → not-found. `childAqlPath` reads `archetype_node_id` only from plain objects.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/valueList.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/valueList.ts src/lib/valueList.test.ts
git commit -m "feat(composition): match composition values to Web Template fields by AQL path"
```

---

### Task 2: Value list model from the Web Template

**Files:**
- Modify: `src/lib/valueList.ts`
- Test: `src/lib/valueList.test.ts`

**Interfaces:**
- Consumes: `TemplateNode`, `RecordedCode` (Task 1).
- Produces:
  ```ts
  export interface TermBindingRef { terminology: string; code: string }
  export interface ValueListOption {
    code: string; label: string | null; description: string | null;
    ordinal: number | null; bindings: TermBindingRef[];
  }
  export interface ValueListModel {
    fieldName: string; fieldDescription: string | null; rmType: string;
    terminology: string | null; listOpen: boolean; valueSetUrl: string | null;
    options: ValueListOption[]; fieldBindings: TermBindingRef[];
    annotations: Record<string, string>;
  }
  export interface VisibleOptions {
    rows: ValueListOption[];          // at most `cap`, recorded included
    hiddenCount: number;
    recordedNotInList: boolean;       // recorded code absent from options → pinned row at top
  }
  export function templateLanguages(webTemplate: Record<string, unknown>): { languages: string[]; defaultLanguage: string | null };
  export function pickLanguage(compositionLanguage: string | null, languages: string[], defaultLanguage: string | null): string | null;
  export function normaliseBindings(raw: unknown): TermBindingRef[];
  export function extractValueSetUrl(node: TemplateNode): string | null;
  export function buildValueListModel(node: TemplateNode, language: string | null): ValueListModel;
  export function visibleOptions(options: ValueListOption[], recorded: RecordedCode, cap?: number /* default 200 */): VisibleOptions;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
describe("pickLanguage", () => {
  it("prefers the composition language when the template has it", () =>
    expect(pickLanguage("sl", ["en", "sl"], "en")).toBe("sl"));
  it("falls back to the template default, then the first language", () => {
    expect(pickLanguage("de", ["en", "sl"], "sl")).toBe("sl");
    expect(pickLanguage(null, ["en", "sl"], null)).toBe("en");
    expect(pickLanguage(null, [], null)).toBeNull();
  });
});

describe("normaliseBindings", () => {
  it("accepts { TERM: { value: { codeString } } }, { TERM: { codeString } } and '[TERM::code]' shapes", () => {
    expect(normaliseBindings({ "SNOMED-CT": { value: { codeString: "8517006" } } }))
      .toEqual([{ terminology: "SNOMED-CT", code: "8517006" }]);
    expect(normaliseBindings({ LOINC: { codeString: "72166-2" } })).toEqual([{ terminology: "LOINC", code: "72166-2" }]);
    expect(normaliseBindings({ "SNOMED-CT": "[SNOMED-CT(2003)::8517006]" })).toEqual([{ terminology: "SNOMED-CT", code: "8517006" }]);
  });
  it("returns [] for missing or unrecognised input", () => {
    expect(normaliseBindings(undefined)).toEqual([]);
    expect(normaliseBindings(42)).toEqual([]);
  });
});

describe("extractValueSetUrl", () => {
  it("reads url= from a terminology:// expand reference", () =>
    expect(extractValueSetUrl({ inputs: [{ suffix: "code", terminology:
      "terminology://fhir.hl7.org/ValueSet/$expand?url=http://example.org/vs/smoking" }] }))
      .toBe("http://example.org/vs/smoking"));
  it("accepts a direct http(s) ValueSet URL", () =>
    expect(extractValueSetUrl({ inputs: [{ suffix: "code", terminology: "http://example.org/fhir/ValueSet/smoking" }] }))
      .toBe("http://example.org/fhir/ValueSet/smoking"));
  it("returns null for plain terminology ids", () =>
    expect(extractValueSetUrl({ inputs: [{ suffix: "code", terminology: "SNOMED-CT" }] })).toBeNull());
});

describe("buildValueListModel", () => {
  // fixture: DV_CODED_TEXT node "overall_status", localizedNames {en:"Smoking status", sl:"Status kajenja"},
  //   localizedDescriptions {en:"Current or past tobacco use", sl:"Trenutna ali pretekla raba tobaka"},
  // inputs[{ suffix:"code", type:"CODED_TEXT", terminology:"A06_smoking",
  //   list:[{ value:"1", label:"Never smoked", localizedLabels:{en:"Never smoked", sl:"Nekadilec"}, localizedDescriptions:{en:"Never smoked", sl:"Nikoli kadil"} },
  //         { value:"2", label:"Former smoker", localizedLabels:{en:"Former smoker"} }] }]
  it("uses the selected language for field and option text", () => {
    const m = buildValueListModel(fixture, "sl");
    expect(m.fieldName).toBe("Status kajenja");
    expect(m.terminology).toBe("A06_smoking");
    expect(m.options[0]).toMatchObject({ code: "1", label: "Nekadilec", description: "Nikoli kadil" });
  });
  it("falls back to the default label and a null description when a translation is missing", () =>
    expect(buildValueListModel(fixture, "sl").options[1]).toMatchObject({ code: "2", label: "Former smoker", description: null }));
  it("carries ordinals for DV_ORDINAL lists", () => {
    // fixture2: rmType DV_ORDINAL, list item { value:"at0012", label:"Severe", ordinal: 3 }
    expect(buildValueListModel(fixture2, "en").options[0].ordinal).toBe(3);
  });
});

describe("visibleOptions", () => {
  it("flags a recorded code that is not in the list", () =>
    expect(visibleOptions([opt("1"), opt("3")], rec("2")).recordedNotInList).toBe(true));
  it("caps rows but always includes the recorded option", () => {
    const many = Array.from({ length: 500 }, (_, i) => opt(String(i)));
    const v = visibleOptions(many, rec("450"), 200);
    expect(v.rows).toHaveLength(200);
    expect(v.rows.some((r) => r.code === "450")).toBe(true);
    expect(v.hiddenCount).toBe(300);
  });
});
```

(`opt(code)` / `rec(code)` are tiny local factories in the test file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/valueList.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement the six functions in `src/lib/valueList.ts`**

`buildValueListModel`: code input = `inputs.find(i => i.suffix === "code" || i.suffix === undefined)`; `fieldName` = `localizedNames[lang] ?? localizedName ?? name ?? id`; `listOpen` from the input; option `bindings` via `normaliseBindings(item.termBindings)`; `fieldBindings` via `normaliseBindings(node.termBindings)`; `annotations` = string values of `node.annotations`. `visibleOptions`: when over the cap, take the first `cap - 1` plus the recorded option (if beyond them), preserving list order.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/valueList.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/valueList.ts src/lib/valueList.test.ts
git commit -m "feat(composition): build value list model from Web Template nodes"
```

---

### Task 3: Panel state resolution, including external lists

**Files:**
- Modify: `src/lib/valueList.ts`
- Test: `src/lib/valueList.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2; `CodeDescription`, `ValueSetExpansion`, `expandValueSet`, `describeCode` from `src/lib/terminology.ts`.
- Produces:
  ```ts
  export type PanelState =
    | { kind: "loading" }
    | { kind: "unavailable"; reason: string }                         // no template / not matched / ambiguous
    | { kind: "list"; model: ValueListModel; source: "template" | "terminology-server" }
    | { kind: "external-unavailable"; model: ValueListModel; reason: string; description: CodeDescription | null };
  export interface ExternalDeps {
    expandValueSet: (serverId: string, url: string, filter?: string, count?: number) => Promise<ValueSetExpansion>;
    describeCode: (serverId: string, system: string, code: string) => Promise<CodeDescription>;
  }
  /** Synchronous part: template-backed result, or "needs-external" for fields without a list. */
  export function resolvePanelState(
    webTemplate: Record<string, unknown> | null, selection: CodedValueSelection, language: string | null,
  ): PanelState | { kind: "needs-external"; model: ValueListModel };
  export function loadExternalState(
    serverId: string | null, model: ValueListModel, recorded: RecordedCode, deps?: ExternalDeps, // default: real terminology.ts fns
  ): Promise<PanelState>;
  ```

- [ ] **Step 1: Write the failing tests** — exact reason strings are part of the contract (the panel shows them verbatim):

```ts
describe("resolvePanelState", () => {
  it("reports a missing template", () =>
    expect(resolvePanelState(null, sel, "en")).toEqual({ kind: "unavailable", reason: "The template for this composition could not be loaded." }));
  it("reports an unmatched field", () =>
    expect(resolvePanelState(tplWithoutField, sel, "en")).toEqual({ kind: "unavailable", reason: "This value's field was not found in the template." }));
  it("reports an ambiguous field", () =>
    expect(resolvePanelState(tplWithTwoSamePathFields, sel, "en")).toEqual({ kind: "unavailable",
      reason: "This value matches 2 fields in the template that can't be told apart." }));
  it("returns the template list when the field has one", () =>
    expect(resolvePanelState(tpl, sel, "en")).toMatchObject({ kind: "list", source: "template" }));
  it("asks for an external lookup when the field has no list", () =>
    expect(resolvePanelState(tplSnomedField, sel, "en")).toMatchObject({ kind: "needs-external" }));
});

describe("loadExternalState", () => {
  it("expands the value set and lists its concepts", async () => {
    const deps = { expandValueSet: async () => ({ total: 2, concepts: [
      { system: "http://snomed.info/sct", code: "8517006", display: "Ex-smoker" },
      { system: "http://snomed.info/sct", code: "77176002", display: "Smoker" }] }), describeCode: vi.fn() };
    const s = await loadExternalState("srv", { ...model, valueSetUrl: "http://vs" }, recSnomed, deps);
    expect(s).toMatchObject({ kind: "list", source: "terminology-server" });
    expect((s as any).model.options.map((o: any) => o.code)).toEqual(["8517006", "77176002"]);
  });
  it("without a value set, describes the recorded code and explains why", async () => {
    const deps = { expandValueSet: vi.fn(), describeCode: async () => descEx };
    expect(await loadExternalState("srv", { ...model, valueSetUrl: null }, recSnomed, deps)).toEqual({
      kind: "external-unavailable", model: { ...model, valueSetUrl: null },
      reason: "The template doesn't name a value set for this field.", description: descEx });
  });
  it("on expansion failure, falls back to describe and includes the error", async () => {
    const deps = { expandValueSet: async () => { throw "HTTP 404: unknown ValueSet"; }, describeCode: async () => descEx };
    expect(await loadExternalState("srv", { ...model, valueSetUrl: "http://vs" }, recSnomed, deps))
      .toMatchObject({ kind: "external-unavailable", reason: "The terminology server couldn't expand the value set: HTTP 404: unknown ValueSet" });
  });
  it("with no terminology server, still resolves with description null", async () => {
    const deps = { expandValueSet: async () => { throw "No terminology server configured"; },
                   describeCode: async () => { throw "No terminology server configured"; } };
    expect(await loadExternalState("srv", { ...model, valueSetUrl: "http://vs" }, recSnomed, deps))
      .toMatchObject({ kind: "external-unavailable", description: null });
  });
});
```

(`vi` from `vitest`; fixtures built from Task 1/2 fixtures.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/valueList.test.ts`
Expected: FAIL — `resolvePanelState` / `loadExternalState` missing.

- [ ] **Step 3: Implement both functions**

`loadExternalState` requests at most 1000 concepts (`count`), maps concepts to `ValueListOption` (`label` = `display`, no description/ordinal/bindings), and never rejects. `serverId === null` behaves like "no terminology server configured" without calling deps.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/valueList.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/valueList.ts src/lib/valueList.test.ts
git commit -m "feat(composition): resolve value list panel state incl. FHIR value set expansion"
```

---

### Task 4: `ValueListPanel` component and stories

**Files:**
- Create: `src/components/ValueListPanel.vue`
- Create: `src/components/ValueListPanel.stories.ts`

**Interfaces:**
- Consumes: `PanelState`, `CodedValueSelection`, `visibleOptions` (Tasks 1–3).
- Produces: component with
  ```ts
  props: { selection: CodedValueSelection; state: PanelState; languages: string[]; language: string | null; templateId: string | null }
  emits: { close: []; "update:language": [language: string] }
  ```

- [ ] **Step 1: Implement the panel**

Same shell as `FlatPathPanel.vue` (350px column, `--color-bg-secondary`, `.panel-header` with `h3` = field name or the recorded label, and an icon close button `aria-label="Close value list"`). Escape on the panel emits `close`. Body by `state.kind`:
- `loading`: "Loading value list…"
- `unavailable`: the reason, then the recorded label, code and terminology.
- `list` / `external-unavailable`: meta line (terminology id, RM type, template id; field description below in `--color-text-secondary`); language buttons (`aria-pressed`) when `languages.length > 1`; table rows from `visibleOptions(...)` with columns Code, Label (+ description beneath), and Score when any option has an `ordinal`. Recorded row gets class `recorded` + `aria-current="true"` and is scrolled into view on mount/selection change. If `recordedNotInList`, a pinned first row reads "recorded — not in template list". If `hiddenCount > 0`: "…and {n} more not shown". Then term bindings (`TERM code`, per option and field) and annotations (key: value) when non-empty. For `external-unavailable`, show the reason and, if present, the description's display, designations and properties instead of the table.
- `source: "terminology-server"`: small caption "From the terminology server".
Highlight colour from an existing token (check `tokens.css`; if none suits, add `--color-highlight-bg`/`--color-highlight-text` there with both themes, and keep `contrast.test.ts` passing).

- [ ] **Step 2: Write stories** `LocalList` (A06_smoking, sl/en, recorded "2", with a SNOMED binding on "2"), `Ordinal`, `ExternalExpanded`, `ExternalUnavailable` (no value set, with description), `RecordedNotInList`, `NotMatched`, `Loading` — args built from Task 2/3 types.

- [ ] **Step 3: Type-check, lint, build Storybook, run a11y**

Run: `npx vue-tsc --noEmit && npm run lint && npm run fmt:check && npm run build-storybook && npm run test:a11y && npx vitest run`
Expected: all pass (axe reports no color-contrast violations; `contrast.test.ts` green).

- [ ] **Step 4: Commit**

```bash
git add src/components/ValueListPanel.vue src/components/ValueListPanel.stories.ts src/styles/tokens.css
git commit -m "feat(composition): add value list side panel component"
```

---

### Task 5: Wire it into the Composition Viewer

**Files:**
- Modify: `src/components/CompositionTree.vue` (`buildTree`, `TreeNode`/`TreeNodeType`, `TreeNodeComponent` render, styles)
- Modify: `src/views/CompositionViewer.vue` (state, FLAT Paths toggle, panel slot)
- Modify: `src/lib/whats-new.ts` (new entry at the top)
- Modify: `docs/prd/PRD-0019-composition-value-list-panel.md` (`Status: Implemented`)

**Interfaces:**
- Consumes: `childAqlPath`, `extractRecordedCode`, `CodedValueSelection` (Task 1); `templateLanguages`, `pickLanguage` (Task 2); `resolvePanelState`, `loadExternalState`, `PanelState` (Task 3); `ValueListPanel` (Task 4).
- Produces: `CompositionTree` emits `select-coded-value: [selection: CodedValueSelection]` and accepts `selectedTreePath?: string | null` (marks the active value).

- [ ] **Step 1: CompositionTree — paths and click**

In `buildTree`, carry `aqlPath` alongside `path` using `childAqlPath` (root = `""`). For a node where `extractRecordedCode(obj)` returns a value, attach `selection: CodedValueSelection` (`treePath` = the node's `path`; `elementName` = the parent ELEMENT's `name.value`, passed down from the parent call). In `TreeNodeComponent`, nodes with a `selection` render their value as a `<button type="button" class="node-value coded-value-button">` (keeps the existing resolved-term/coded-ref text) whose click calls an `onSelectCodedValue` callback prop threaded down the recursion; the root `<script setup>` passes `(s) => emit("select-coded-value", s)`. Add a `selected` class when `node.path === selectedTreePath` (threaded down like `highlightedPath`). Native button gives Enter/Space; style it like the current value text plus underline-on-hover and a focus ring from tokens.

- [ ] **Step 2: CompositionViewer — state and panel**

Replace `showFlatPaths` with `rightPanel = ref<"paths" | "values" | null>(null)`; "Show/Hide Paths" toggles `"paths"`; `with-sidebar` when `rightPanel !== null`. Add `selection`, `panelState`, `panelLanguage`; pass `selection?.treePath ?? null` as `selected-tree-path`. On `select-coded-value`: set `rightPanel = "values"`, `panelLanguage = pickLanguage(composition.language?.code_string, …templateLanguages(webTemplate))`, `panelState = resolvePanelState(...)`; if `needs-external`, set `{ kind: "loading" }` then `await loadExternalState(serverStore.activeServerId, model, selection.recorded)`, discarding the result if a newer selection arrived (request-id guard as in `src/stores/ehr.ts`). Language change re-runs `resolvePanelState` (template-backed states only). Closing clears `selection` and `rightPanel`. Reset all of it when the route's composition changes.

- [ ] **Step 3: What's New + PRD status**

Prepend to `WHATS_NEW` (version `0.11.0`, today's date): title "See a coded value in its full value list", description "In the composition viewer, click a coded value to open a side panel listing every option the template allows, in every language it carries, with the recorded one highlighted. Fields bound to SNOMED CT or other external terminologies are expanded via your terminology server." No `tourId`. Set the PRD status to `Implemented`.

- [ ] **Step 4: Full verification**

Run: `npx vue-tsc --noEmit && npm run lint && npm run fmt:check && npx vitest run && npm run build-storybook && npm run test:a11y`
Expected: all pass (incl. `caret-glyphs.test.ts`, `whats-new.test.ts`).

Then `npm run tauri dev`, open a composition with a coded value: panel opens on click, updates on another click, ✕/Escape closes, "Show Paths" swaps the panels, JSON/FLAT tabs unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/components/CompositionTree.vue src/views/CompositionViewer.vue src/lib/whats-new.ts docs/prd/PRD-0019-composition-value-list-panel.md
git commit -m "feat(composition): open value list panel when clicking coded values"
```
