# Session log: Better CDR fixes and the value list panel (2026-10-16/17)

A working session that tested openEHR Explorer against a Better Platform CDR (`zzora-test.ss.ezdrav.si`, a VPN-only test system at the Oncology Institute Ljubljana). It records each problem in the order it came up, what caused it, what was changed, and what is still open.

Branch: `feat/template-fetch-fix` (not pushed).

## 1. Building a local macOS app

```bash
npm install
npm run tauri build -- --bundles app
cp -R "src-tauri/target/release/bundle/macos/openEHR Explorer.app" /Applications/
```

The build is unsigned (`signingIdentity: null`). A local build has no download quarantine flag, so macOS opens it without the "unidentified developer" warning. For a universal (Apple Silicon + Intel) binary, use `--target universal-apple-darwin`.

## 2. Server profile for this CDR

- **Base URL:** `https://zzora-test.ss.ezdrav.si/ehr`. Leave **API path prefix** empty, so it defaults to `/rest/openehr/v1`.
- `/ehr` must be part of the Base URL. Better's own API lives at `/ehr/rest/v1/…`, and `/rest/v1/…` at the host root is a web page that answers 200 HTML. The Better-specific fallbacks below only work with this setup.
- **Code-list service URL** (new, see §8): `https://zzora-test.ss.ezdrav.si/terminology-adapter/rest/terminology`

## 3. Templates answered 406 (commit `ddf5731`)

Better's openEHR endpoint doesn't serve the Web Template media type. On a 406, `get_web_template` falls back to Better's own API at `{base_url}/rest/v1/template/{id}` and unwraps `webTemplate` from the response. **Confirmed working** on this server.

## 4. AQL "error sending request" and slow EHR list (commit `c73577e`)

- **Error messages:** `inspector.rs` now prints the error's full cause chain, e.g. `…: operation timed out`, instead of only "error sending request".
- **Query timeout:** ad-hoc and stored AQL queries can run for up to 300 s. Other requests keep the 30 s client default.
- **EHR Browser default query:** `ORDER BY e/time_created/value DESC` took about 300 ms, but adding the second sort key `, e/ehr_id/value ASC` made the query time out on this large CDR.
  - The second sort key is now added only when sorting by `system_id`, where ties are common.
  - If a sorted list query still times out, the app falls back to the unsorted query.
  - The store remembers that fallback per server, so later pages ask for the unsorted list directly instead of waiting out the timeout each time.

## 5. FLAT paths empty (commit `5d310db`)

The FLAT request answered 406 too. It now falls back to `{base_url}/rest/v1/composition/{uid}?format=FLAT` and unwraps Better's `{ meta, format, templateId, composition }` envelope. The envelope is recognised by having no key that contains `/`.

The viewer used to swallow FLAT errors silently. It now shows "FLAT format unavailable: …" in the paths panel and as a tooltip on the FLAT tab. **Not yet confirmed** on the server.

## 6. Terminology 422s (commit `9c70a3e`)

`lookup_code` no longer sends `$lookup` requests to the FHIR server for template-local code systems like `A06_smoking`. It only asks about known terminology names (SNOMED CT, LOINC, ICD-10/11, ATC) and URIs.

## 7. Value list panel (PRD-0019, commits `12206bb`…`dbac4e9`, merged)

Clicking a coded value in the Pretty view opens a right-side panel showing the field's whole value list, with the recorded option highlighted.

**Decided with the user:**
- a side panel rather than a modal
- show everything the template provides: labels and descriptions per language, ordinal scores, term bindings and annotations
- external terminologies are expanded through the FHIR terminology server
- the language starts on the composition's language
- only one right-hand panel (FLAT paths or value list) is open at a time

**Built:** the plan in `docs/superpowers/plans/2026-10-16-composition-value-list-panel.md`, executed inline with TDD.
- All logic is in `src/lib/valueList.ts` (tests in `valueList.test.ts`).
- The panel is `src/components/ValueListPanel.vue`, with Storybook stories.

**Final review:** a fresh reviewer found no critical issues and three important ones, all fixed with tests that failed first:
- choice elements (coded or plain text) were always reported as "ambiguous"; they now resolve by the recorded RM type
- a recorded code beyond the fetched part of a large value set was wrongly flagged as "not in template list"
- Escape pressed in the search overlay also closed the value panel

**Deferred minors:**
- switching server while viewing the same composition UID leaves a stale panel open
- `null_flavour` / `TERM_MAPPING.purpose` values are clickable but never match a template field
- no disambiguation by ancestor names
- duplicate codes collide as row keys
- the panel stays open on the JSON/FLAT tabs

**Not run locally:** `npm run test:a11y`, because the Playwright browser download hung. CI runs it.

## 8. Where `A06_smoking`'s codes actually live (commits `90410b9`, `5d1bc1d`)

The user found that the panel showed only the recorded code. Investigation:

1. **Web Template:** the field `…/items[at0089]/value` (Overall status) has **no `inputs`**, so it names no codes and no terminology.
2. **OPT:** the field's `defining_code` is an **empty `C_CODE_REFERENCE`**, with no code list and no reference-set URI. The same holds for all 9 code references in the template. `A06_smoking` appears only in the recorded data.
3. **Better forms** (`GET /ehr/rest/v1/form` lists 255 forms; the Anamnesis form is at `/ehr/rest/v1/form/Anamnesis/1.0.157?resources=…`): the form environment defines an external API, **"Zorica Terminologies"**. Its calls go to `GET {terminologyUrl}` with a `{codeSystem}` path parameter. Fields point at a code system through `inputs[].terminology` and `viewConfig.datasource.loadRemoteUrl`. `terminologyUrl` is "externally provided": the Zorica portal supplies it to the form at runtime.
4. **The service itself** (found through the portal admin page `/portal/admin/terminologies`), which needs **no login**:
   - `GET …/terminology-adapter/rest/terminology/codesystems?pagesize=N` → `{ items: [{ code, description, version, languages, lastModified }], lastPage }`
   - `GET …/codesystem/A06_smoking` → `{ code, languages: ["sl","en"], … }`
   - `GET …/codesystem/A06_smoking/entities?pagesize=N&language=en` → `{ items: [{ code, description, user_code }], lastPage }`. The default language is sl. `language=` works; `meta.language` and `lang` don't.
   - `GET …/codesystem/A06_smoking/entity/2` → one entry
   - `A06_smoking` = 1 Never smoked / Nikoli ni kadila (A06.1), 2 Former smoker / Bivša kadilka (A06.2), 3 Current smoker / Kadilka (A06.3)
   - Unknown paths under the host return the portal SPA (200 HTML), so probing addresses by status code tells you nothing.

**Implemented (all checks green):**
- **Server profile:** new optional `code_list_url`, in Rust and TypeScript and in the server form.
- **Backend:** command `get_code_list(server_id, code_system, language)` in `src-tauri/src/commands/code_list.rs`. It fetches the entities and the code system's languages, never sends CDR credentials, and has 6 unit tests.
- **Lookup order** for a field the template doesn't list: `usesCodeListService(terminology)` is true unless the id is a FHIR terminology name, a URI, `local` or `openehr`. When true, `loadExternalState` lists the codes from the code-list service, with user codes and the code system's own languages; the language switch re-fetches. Otherwise the FHIR path is used, as before.
- **Two click targets**, as the user asked:
  - the **terminology badge** (e.g. `A06_SMOKING`) opens the **full list**
  - the **value** opens **only the recorded code** (label, code, user code, description, score, bindings)
  - ordinals now get a badge too
- **PRD-0019:** amended with all of the above.

**Follow-up (user request):** the panel now has a **Source** section showing where the list came from. For a template list it names the template (Web Template). For the code-list service it names the code system and the exact URL fetched, which the backend returns as `source_url`. For a FHIR expansion it shows the value set URL; for a FHIR lookup it says so. The user confirmed the code-list listing works in the app.

**Checks:**
- Rust: 131 tests, clippy, fmt
- frontend: 193 vitest tests, vue-tsc, oxlint, oxfmt
- Storybook builds, with new `CodeListService` and `RecordedCodeDetail` stories

## 9. Local code systems in the Terminology page (commits `2ef166a`, `46b1492`)

The user asked for the code-list service's code systems (270 on this server) in the Terminology page's system dropdown.

**Behaviour, agreed with the user:**
- **Picker:** local systems are listed after SNOMED CT, LOINC, ICD and ATC, labelled by description and marked "Code list · <languages>".
- **Describe:** looks up one code via `…/codesystem/{id}/entity/{code}` and shows the description, user code and language, with a language switch and the source URL.
- **Validate:** answers "is the code in the list". The value-set field is hidden, since local lists have no value sets.
- **Subsumes:** local systems aren't offered; the lists are flat.
- **Expand:** has a new "Code list (all codes)" mode. It lists every code with description and user code, filters client-side, has a language switch, a Describe button per code, and shows the source URL.
- **Without a FHIR server:** the page now works when only a code-list URL is configured, with a note that only code lists are available.

**Backend:** new commands `list_code_systems` (returns empty when the profile has no code-list URL) and `get_code_list_entry`. An unknown code returns `None`; an unknown code system is an error, read from the service's 404 JSON `errorMessage` and `resourceType`.

**Checks:**
- Rust: 136 tests, clippy, fmt
- frontend: 197 vitest tests, vue-tsc, oxlint, oxfmt
- Storybook builds, with 2 new picker stories

## Commit history on `feat/template-fetch-fix`

| Commit | What |
|---|---|
| `ddf5731` | Web Template 406 → Better `/rest/v1/template` fallback |
| `c73577e` | EHR list sorting + timeout fallback |
| `5d310db` | FLAT 406 → Better `/rest/v1/composition?format=FLAT` fallback, visible FLAT errors |
| `9c70a3e` | No FHIR `$lookup` for local code systems |
| `12206bb`…`dbac4e9` | PRD-0019 value list panel (plan, 5 tasks, review fixes), merged from `feat/value-list-panel` |
| `90410b9` | Code-list service: `code_list_url`, `get_code_list`, badge → full list / value → recorded code, Source section |
| `5d1bc1d` | PRD-0019 amendment + this session log |
| `2ef166a` | Local code systems in the Terminology page |
| `46b1492` | Session log §9 |

The user pushes between steps; after the last commit, the branch was 2 commits ahead of `origin`.

## Open items

- **Not yet tried in the app:** the code-list listing in the value panel is confirmed working, but the Source section and the Terminology page changes (§9) haven't been tried yet.
- **FLAT fallback:** confirm it against the real server.
- **Public repo:** PRD-0019's amendment and this log contain the internal hostname `zzora-test.ss.ezdrav.si`, and the repo is public. The earlier commits look already pushed. Decide whether to replace it with a placeholder in a follow-up commit.
- **PR:** open a PR for `feat/template-fetch-fix`.
- **Deferred minors from §7.**
- **Local `test:a11y`:** never ran, because the Playwright browser download hung; CI covers it.
