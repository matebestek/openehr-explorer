<script setup lang="ts">
// Forms (PRD-0020): browse a Better Platform server's form definitions.
// Left: one row per form name (versions grouped). Right: the selected
// version with its facts and collapsible Overview / Fields / Environment /
// Layout / Raw JSON sections. All interpretation lives in src/lib/forms.ts.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useServerStore } from "../stores/server";
import { useFormStore } from "../stores/form";
import { useAnalytics } from "../composables/useAnalytics";
import CollapsibleSection from "../components/CollapsibleSection.vue";
import CopyButton from "../components/CopyButton.vue";
import JsonViewer from "../components/JsonViewer.vue";
import RefreshButton from "../components/RefreshButton.vue";
import FormFieldTree from "../components/FormFieldTree.vue";
import FormEnvironment from "../components/FormEnvironment.vue";
import FormLayoutOutline from "../components/FormLayoutOutline.vue";
import {
  buildFieldTree,
  environmentModel,
  filterGroups,
  formLanguages,
  layoutOutline,
  resource,
  typeChips,
  type FieldNode,
  type FormGroup,
} from "../lib/forms";

const props = defineProps<{
  name?: string;
  version?: string;
}>();

const router = useRouter();
const serverStore = useServerStore();
const formStore = useFormStore();
const analytics = useAnalytics();

const isBetter = computed(() => serverStore.activeServer?.server_type === "better_platform");

const SERVER_TYPE_NAMES: Record<string, string> = {
  ehrbase: "EHRbase",
  better_platform: "Better Platform",
  ferro_ehr: "FerroEHR",
  generic: "Generic",
};
const serverTypeName = computed(() => {
  const type = serverStore.activeServer?.server_type;
  return type ? (SERVER_TYPE_NAMES[type] ?? type) : "";
});

// --- List ----------------------------------------------------------------
const filterText = ref("");
const activeChip = ref<string | null>(null);
const chips = computed(() => typeChips(formStore.groups));
const visibleGroups = computed(() =>
  filterGroups(formStore.groups, filterText.value, activeChip.value),
);

function toggleChip(chip: string) {
  activeChip.value = activeChip.value === chip ? null : chip;
}

function loadList() {
  const serverId = serverStore.activeServerId;
  if (serverId && isBetter.value) void formStore.fetchForms(serverId);
}

watch(
  () => [serverStore.activeServerId, isBetter.value] as const,
  () => {
    formStore.clear();
    activeChip.value = null;
    loadList();
  },
  { immediate: true },
);

function openGroup(group: FormGroup) {
  router.push({
    name: "form-detail",
    params: { name: group.name, version: group.latest.version },
  });
}

// --- Selected form ---------------------------------------------------------
const selectedGroup = computed(() => formStore.groups.find((g) => g.name === props.name) ?? null);

watch(
  () => [serverStore.activeServerId, props.name, props.version, isBetter.value] as const,
  ([serverId, name, version, better]) => {
    if (!serverId || !name || !version || !better) return;
    void formStore.fetchForm(serverId, name, version);
    void analytics.track("forms_viewed");
  },
  { immediate: true },
);

function selectVersion(event: Event) {
  const version = (event.target as HTMLSelectElement).value;
  if (props.name) router.push({ name: "form-detail", params: { name: props.name, version } });
}

const form = computed(() => formStore.selected);
const summary = computed(() => form.value?.summary ?? null);
const typeLabels = computed(() =>
  (summary.value?.tags._form_labels ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean),
);

const overviewRows = computed(() => {
  const s = summary.value;
  if (!s) return [] as [string, string][];
  const rows: [string, string][] = [
    ["name", s.name],
    ["version", s.version],
    ["templateId", s.template_id ?? ""],
    ["createdTimestamp", s.created_timestamp ?? ""],
    ["status", s.status ?? ""],
    ["category", s.category ?? ""],
    ["creator", s.creator ?? ""],
    ["type", s.form_type ?? ""],
    ["schemaVersion", s.schema_version ?? ""],
  ];
  for (const [key, value] of Object.entries(s.tags)) rows.push([`tag: ${key}`, value]);
  if (form.value?.href) rows.push(["href", form.value.href]);
  return rows;
});

// Fields
const description = computed(() => (form.value ? resource(form.value, "form-description") : null));
const languages = computed(() => formLanguages(description.value));
const fieldLanguage = ref<string | null>(null);
watch(languages, (langs) => {
  fieldLanguage.value = langs[0] ?? null;
});
const fieldTree = computed(() => buildFieldTree(description.value, fieldLanguage.value));
// Fields is the one section open by default (PRD-0020).
const fieldsOpen = ref(true);
const selectedField = ref<FieldNode | null>(null);
watch(form, () => {
  selectedField.value = null;
});

const selectedFieldFacts = computed(() => {
  const raw = selectedField.value?.raw;
  if (!raw) return [] as [string, string][];
  const facts: [string, string][] = [];
  for (const key of ["formId", "aqlPath", "nodeId", "rmType", "min", "max"]) {
    if (raw[key] !== undefined && raw[key] !== null) facts.push([key, String(raw[key])]);
  }
  return facts;
});

// Environment, layout, raw
const environment = computed(() =>
  environmentModel(form.value ? resource(form.value, "form-environment") : null),
);
const layoutLines = computed(() =>
  layoutOutline(form.value ? resource(form.value, "form-layout") : null),
);

function asText(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
}
</script>

<template>
  <div class="form-browser">
    <div v-if="!serverStore.activeServerId" class="empty-state full">
      <h3>No server selected</h3>
      <p>Select a Better Platform server to browse its forms.</p>
    </div>

    <div v-else-if="!isBetter" class="empty-state full">
      <h3>Forms are a Better Platform feature</h3>
      <p>
        The active server profile's type is {{ serverTypeName }}. Forms are only available on
        servers of type Better Platform. Check the profile's server type in
        <router-link to="/servers">Server Manager</router-link>.
      </p>
    </div>

    <template v-else>
      <div class="panel-left">
        <div class="panel-header">
          <h2>Forms</h2>
          <RefreshButton title="Refresh forms" :loading="formStore.listLoading" @click="loadList" />
        </div>
        <div class="search-bar">
          <label for="form-filter-input" class="sr-only">Filter forms</label>
          <input
            id="form-filter-input"
            v-model="filterText"
            class="input search-input"
            placeholder="Filter forms by name or template..."
          />
        </div>
        <div v-if="chips.length > 0" class="chips" role="group" aria-label="Form type">
          <button
            v-for="chip in chips"
            :key="chip"
            type="button"
            class="chip"
            :aria-pressed="activeChip === chip"
            @click="toggleChip(chip)"
          >
            {{ chip }}
          </button>
        </div>

        <div v-if="formStore.listLoading && formStore.groups.length === 0" class="loading">
          Loading forms...
        </div>
        <div v-else-if="formStore.listError" class="error-msg">{{ formStore.listError }}</div>
        <div v-else-if="visibleGroups.length === 0" class="empty-hint">No forms match.</div>

        <button
          v-for="group in visibleGroups"
          :key="group.name"
          type="button"
          class="form-item"
          :class="{ active: group.name === name }"
          @click="openGroup(group)"
        >
          <span class="form-name">{{ group.name }}</span>
          <span class="form-meta">
            {{ group.templateId ?? "no template" }} · v{{ group.latest.version }}
            <template v-if="group.typeLabels.length"> · {{ group.typeLabels.join(", ") }}</template>
            <template v-if="group.versions.length > 1">
              · {{ group.versions.length }} versions</template
            >
          </span>
        </button>
      </div>

      <div class="panel-right">
        <div v-if="!name || !version" class="empty-state">
          <p>Select a form to see its definition.</p>
        </div>
        <div v-else-if="formStore.formLoading" class="loading">Loading form...</div>
        <div v-else-if="formStore.formError" class="error-msg">{{ formStore.formError }}</div>

        <template v-else-if="summary">
          <div class="panel-header form-header">
            <div class="title-row">
              <h2>{{ summary.name }}</h2>
              <label class="version-picker">
                <span class="sr-only">Version</span>
                <select class="input" :value="summary.version" @change="selectVersion">
                  <option
                    v-for="(v, i) in selectedGroup?.versions ?? [summary.version]"
                    :key="v"
                    :value="v"
                  >
                    {{ v }}{{ i === 0 ? " (latest)" : "" }}
                  </option>
                </select>
              </label>
            </div>
            <p class="facts">
              <template v-if="summary.template_id">
                Template
                <router-link
                  :to="{ name: 'template-detail', params: { templateId: summary.template_id } }"
                  >{{ summary.template_id }}</router-link
                >
                ·
              </template>
              <template v-if="typeLabels.length">{{ typeLabels.join(", ") }} · </template>
              {{ summary.status ?? "unknown status" }} · created by {{ summary.creator ?? "?" }}
              <template v-if="summary.tags._username">
                · last edited by {{ summary.tags._username }}</template
              >
              <template v-if="summary.created_timestamp">
                · {{ summary.created_timestamp }}</template
              >
            </p>
            <p v-if="summary.tags._revision_comment" class="revision">
              “{{ summary.tags._revision_comment }}”
            </p>
          </div>

          <CollapsibleSection title="Overview" :summary="`${overviewRows.length} attributes`">
            <table class="kv-table">
              <tbody>
                <tr v-for="[key, value] in overviewRows" :key="key">
                  <th scope="row">{{ key }}</th>
                  <td>{{ value }}</td>
                </tr>
              </tbody>
            </table>
          </CollapsibleSection>

          <CollapsibleSection v-model:open="fieldsOpen" title="Fields">
            <div v-if="languages.length > 1" class="lang-group" role="group" aria-label="Language">
              <button
                v-for="lang in languages"
                :key="lang"
                type="button"
                class="chip"
                :aria-pressed="fieldLanguage === lang"
                @click="fieldLanguage = lang"
              >
                {{ lang }}
              </button>
            </div>
            <p v-if="!fieldTree" class="empty-hint">This form has no field description.</p>
            <div v-else class="fields">
              <div class="field-tree">
                <FormFieldTree
                  :tree="fieldTree"
                  :selected-key="selectedField?.key ?? null"
                  @select="selectedField = $event"
                />
              </div>
              <div v-if="selectedField" class="field-details">
                <h4>{{ selectedField.label }}</h4>
                <table class="kv-table">
                  <tbody>
                    <tr v-for="[key, value] in selectedFieldFacts" :key="key">
                      <th scope="row">{{ key }}</th>
                      <td class="mono">{{ value }}</td>
                    </tr>
                  </tbody>
                </table>
                <div class="json-box small">
                  <JsonViewer :value="selectedField.raw" :default-collapsed-depth="2" />
                </div>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="Environment"
            :summary="`${environment.variables.length} variables, ${environment.apis.length} external APIs`"
          >
            <FormEnvironment :model="environment" />
          </CollapsibleSection>

          <CollapsibleSection title="Layout">
            <FormLayoutOutline :lines="layoutLines" />
          </CollapsibleSection>

          <CollapsibleSection
            title="Raw JSON"
            :summary="`${form?.resources.length ?? 0} resources`"
          >
            <CollapsibleSection
              v-for="res in form?.resources ?? []"
              :key="res.name"
              :title="res.name"
              :summary="res.content === null ? 'empty' : (res.mimetype ?? '')"
            >
              <p v-if="res.content === null" class="empty-hint">This resource is empty.</p>
              <template v-else>
                <CopyButton :text="asText(res.content)" :title="`Copy ${res.name}`" />
                <pre v-if="typeof res.content === 'string'" class="raw-text">{{ res.content }}</pre>
                <div v-else class="json-box">
                  <JsonViewer :value="res.content" :default-collapsed-depth="2" />
                </div>
              </template>
            </CollapsibleSection>
          </CollapsibleSection>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.form-browser {
  display: flex;
  height: 100%;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.panel-left {
  width: 350px;
  min-width: 350px;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.panel-right {
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  background: var(--color-bg);
  z-index: 1;
}
.panel-header h2 {
  font-size: 16px;
  font-weight: 600;
}

.form-header {
  flex-direction: column;
  align-items: stretch;
  padding: 16px 0;
  gap: 4px;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.version-picker select {
  font-size: 12px;
}
.facts,
.revision {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.search-bar {
  padding: 8px 16px;
}
.search-input {
  width: 100%;
}

.chips,
.lang-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chips {
  padding: 0 16px 8px;
}
.lang-group {
  margin-bottom: 8px;
}
.chip {
  font-size: 11px;
  padding: 1px 8px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.chip[aria-pressed="true"] {
  border-color: var(--color-primary);
  color: var(--color-text);
  background: var(--color-surface-hover);
}
.chip:focus-visible,
.form-item:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 16px;
  border: none;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.form-item:hover {
  background: var(--color-surface);
}
.form-item.active {
  background: var(--color-bg-tertiary);
}
.form-name {
  font-size: 13px;
}
.form-meta {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.fields {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.field-tree {
  flex: 1;
  min-width: 0;
}
.field-details {
  width: 40%;
  min-width: 260px;
  position: sticky;
  top: 90px;
}
.field-details h4 {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}

.kv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.kv-table th {
  text-align: left;
  font-weight: 500;
  color: var(--color-text-secondary);
  padding: 3px 8px 3px 0;
  white-space: nowrap;
  vertical-align: top;
}
.kv-table td {
  padding: 3px 0;
  overflow-wrap: anywhere;
}
.mono {
  font-family: var(--font-mono);
  font-size: 11px;
}

/* JsonViewer virtualises against the height it's given (ADR-0023). */
.json-box {
  height: 420px;
  margin-top: 6px;
}
.json-box.small {
  height: 280px;
}
.raw-text {
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.empty-state {
  padding: 24px;
  color: var(--color-text-secondary);
}
.empty-state.full {
  flex: 1;
}
.empty-state h3 {
  color: var(--color-text);
  margin-bottom: 6px;
}
.empty-hint,
.loading {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.error-msg {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--color-error);
  overflow-wrap: anywhere;
}
</style>
