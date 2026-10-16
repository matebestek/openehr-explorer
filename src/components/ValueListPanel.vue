<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  visibleOptions,
  type CodedValueSelection,
  type PanelState,
  type TermBindingRef,
} from "../lib/valueList";

// Side panel showing a clicked coded value within its full value list
// (PRD-0019). Presentational only: CompositionViewer resolves `state` via
// src/lib/valueList.ts and owns selection/language.
const props = defineProps<{
  selection: CodedValueSelection;
  state: PanelState;
  languages: string[];
  language: string | null;
  templateId: string | null;
}>();

const emit = defineEmits<{
  close: [];
  "update:language": [language: string];
}>();

const model = computed(() =>
  props.state.kind === "list" || props.state.kind === "external-unavailable"
    ? props.state.model
    : null,
);

const visible = computed(() =>
  props.state.kind === "list"
    ? visibleOptions(props.state.model.options, props.selection.recorded)
    : null,
);

const hasOrdinals = computed(() => visible.value?.rows.some((o) => o.ordinal !== null) ?? false);

const title = computed(() => model.value?.fieldName || props.selection.elementName || "Value list");

const allBindings = computed(() => {
  if (props.state.kind !== "list") return [];
  const rows: { code: string | null; binding: TermBindingRef }[] = [];
  for (const binding of props.state.model.fieldBindings) rows.push({ code: null, binding });
  for (const option of props.state.model.options) {
    for (const binding of option.bindings) rows.push({ code: option.code, binding });
  }
  return rows;
});

const annotations = computed(() => Object.entries(model.value?.annotations ?? {}));

const listEl = ref<HTMLElement | null>(null);

// Bring the recorded option into view whenever the panel shows a new list.
watch(
  () => [props.selection.treePath, props.state.kind, props.language],
  async () => {
    await nextTick();
    listEl.value?.querySelector<HTMLElement>("tr.recorded")?.scrollIntoView({ block: "nearest" });
  },
  { immediate: true },
);
</script>

<template>
  <aside class="value-list-panel" aria-label="Value list" @keydown.esc="emit('close')">
    <div class="panel-header">
      <h3>{{ title }}</h3>
      <button
        type="button"
        class="close-btn"
        aria-label="Close value list"
        title="Close value list"
        @click="emit('close')"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </button>
    </div>

    <div ref="listEl" class="panel-body">
      <p v-if="state.kind === 'loading'" class="status">Loading value list…</p>

      <template v-else-if="state.kind === 'unavailable'">
        <p class="status">{{ state.reason }}</p>
        <dl class="recorded-summary">
          <dt>Recorded</dt>
          <dd>{{ selection.recorded.label ?? "—" }}</dd>
          <dt>Code</dt>
          <dd class="mono">{{ selection.recorded.code }}</dd>
          <dt>Terminology</dt>
          <dd class="mono">{{ selection.recorded.terminology }}</dd>
        </dl>
      </template>

      <template v-else-if="model">
        <p class="meta">
          <span class="mono">{{ model.terminology ?? selection.recorded.terminology }}</span>
          · {{ model.rmType || selection.recorded.rmType }}
          <template v-if="templateId">
            · <span class="mono">{{ templateId }}</span>
          </template>
        </p>
        <p v-if="model.fieldDescription" class="field-description">{{ model.fieldDescription }}</p>

        <div v-if="languages.length > 1" class="languages" role="group" aria-label="Language">
          <button
            v-for="lang in languages"
            :key="lang"
            type="button"
            class="lang-btn"
            :aria-pressed="lang === language"
            @click="emit('update:language', lang)"
          >
            {{ lang }}
          </button>
        </div>

        <template v-if="state.kind === 'list' && visible">
          <p v-if="state.source === 'terminology-server'" class="caption">
            From the terminology server
          </p>
          <table class="options">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Label</th>
                <th v-if="hasOrdinals" scope="col">Score</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="visible.recordedNotInList" class="recorded" aria-current="true">
                <td class="mono">{{ selection.recorded.code }}</td>
                <td>
                  {{ selection.recorded.label ?? "—" }}
                  <div class="option-description">recorded — not in template list</div>
                </td>
                <td v-if="hasOrdinals">{{ selection.recorded.ordinal ?? "" }}</td>
              </tr>
              <tr
                v-for="option in visible.rows"
                :key="option.code"
                :class="{ recorded: option.code === selection.recorded.code }"
                :aria-current="option.code === selection.recorded.code ? 'true' : undefined"
              >
                <td class="mono">{{ option.code }}</td>
                <td>
                  {{ option.label ?? "—" }}
                  <div v-if="option.description" class="option-description">
                    {{ option.description }}
                  </div>
                </td>
                <td v-if="hasOrdinals">{{ option.ordinal ?? "" }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="visible.hiddenCount > 0" class="caption">
            …and {{ visible.hiddenCount }} more not shown
          </p>

          <section v-if="allBindings.length > 0" class="extra">
            <h4>Term bindings</h4>
            <ul>
              <li v-for="(row, i) in allBindings" :key="i">
                <span v-if="row.code" class="mono">{{ row.code }} → </span>
                <span v-else>Field → </span>
                <span class="mono">{{ row.binding.terminology }} {{ row.binding.code }}</span>
              </li>
            </ul>
          </section>
        </template>

        <template v-else-if="state.kind === 'external-unavailable'">
          <p class="status">{{ state.reason }}</p>
          <dl class="recorded-summary">
            <dt>Recorded</dt>
            <dd>{{ selection.recorded.label ?? "—" }}</dd>
            <dt>Code</dt>
            <dd class="mono">{{ selection.recorded.code }}</dd>
            <template v-if="state.description">
              <dt>Preferred term</dt>
              <dd>{{ state.description.display ?? "—" }}</dd>
              <template v-if="state.description.designations.length > 0">
                <dt>Designations</dt>
                <dd>{{ state.description.designations.join(", ") }}</dd>
              </template>
              <template v-for="p in state.description.properties" :key="p.code">
                <dt>{{ p.code }}</dt>
                <dd>{{ p.value }}</dd>
              </template>
            </template>
          </dl>
        </template>

        <section v-if="annotations.length > 0" class="extra">
          <h4>Annotations</h4>
          <dl class="recorded-summary">
            <template v-for="[key, value] in annotations" :key="key">
              <dt>{{ key }}</dt>
              <dd>{{ value }}</dd>
            </template>
          </dl>
        </section>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.value-list-panel {
  width: 350px;
  min-width: 350px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg-secondary);
  color: var(--color-text);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}
.panel-header h3 {
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.close-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}
.close-btn:focus-visible,
.lang-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  font-size: 12px;
}

.meta {
  color: var(--color-text-secondary);
  margin-bottom: 6px;
  overflow-wrap: anywhere;
}
.field-description {
  color: var(--color-text-secondary);
  margin-bottom: 10px;
}
.status {
  color: var(--color-text-secondary);
  margin-bottom: 10px;
  overflow-wrap: anywhere;
}
.caption {
  color: var(--color-text-muted);
  font-size: 11px;
  margin: 6px 0;
}

.mono {
  font-family: var(--font-mono);
  font-size: 11px;
}

.languages {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}
.lang-btn {
  padding: 2px 8px;
  font-size: 11px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.lang-btn[aria-pressed="true"] {
  background: var(--color-surface-hover);
  border-color: var(--color-primary);
  color: var(--color-text);
}

.options {
  width: 100%;
  border-collapse: collapse;
}
.options th {
  text-align: left;
  font-weight: 600;
  color: var(--color-text-secondary);
  padding: 4px 6px;
  border-bottom: 1px solid var(--color-border);
}
.options td {
  padding: 6px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}
.options tr.recorded td {
  background: var(--color-bg-tertiary);
  font-weight: 600;
}
.options tr.recorded td:first-child {
  box-shadow: inset 3px 0 0 var(--color-primary);
}
.option-description {
  font-weight: 400;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.extra {
  margin-top: 14px;
}
.extra h4 {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}
.extra ul {
  list-style: none;
  padding: 0;
}
.extra li {
  padding: 2px 0;
}

.recorded-summary {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 10px;
}
.recorded-summary dt {
  color: var(--color-text-secondary);
}
.recorded-summary dd {
  overflow-wrap: anywhere;
}
</style>
