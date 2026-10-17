<script setup lang="ts">
// Views (PRD-0021): browse a Better Platform server's stored views, read
// from its admin console. Left: every view; right: the selected view's
// parameters, steps with their code, and the raw definition. Read-only.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useServerStore } from "../stores/server";
import { useViewStore } from "../stores/view";
import { useQueryStore } from "../stores/query";
import { useAnalytics } from "../composables/useAnalytics";
import CollapsibleSection from "../components/CollapsibleSection.vue";
import CopyButton from "../components/CopyButton.vue";
import JsonViewer from "../components/JsonViewer.vue";
import RefreshButton from "../components/RefreshButton.vue";
import ViewStepList from "../components/ViewStepList.vue";
import { filterViews, type ViewSummary } from "../lib/views";
import { returnToListOnServerChange } from "../lib/forms";

const props = defineProps<{
  name?: string;
}>();

const router = useRouter();
const serverStore = useServerStore();
const viewStore = useViewStore();
const queryStore = useQueryStore();
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
const visibleViews = computed(() => filterViews(viewStore.views, filterText.value));

function loadList() {
  const serverId = serverStore.activeServerId;
  if (serverId && isBetter.value) void viewStore.fetchViews(serverId);
}

watch(
  () => [serverStore.activeServerId, isBetter.value] as const,
  ([serverId], previous) => {
    viewStore.clear();
    loadList();
    // A view open from the previous server may not exist on this one.
    if (props.name && returnToListOnServerChange(previous?.[0], serverId)) {
      void router.replace({ name: "views" });
      return;
    }
    openSelectedView();
  },
  { immediate: true },
);

function openView(view: ViewSummary) {
  router.push({ name: "view-detail", params: { name: view.name } });
}

// --- Selected view -----------------------------------------------------------
function openSelectedView() {
  const serverId = serverStore.activeServerId;
  if (!serverId || !props.name || !isBetter.value) return;
  void viewStore.fetchView(serverId, props.name);
  void analytics.track("views_viewed");
}

watch(() => props.name, openSelectedView);

const view = computed(() => viewStore.selected);
const rawText = computed(() => (view.value ? JSON.stringify(view.value.raw, null, 2) : ""));

function openInAqlRunner(aql: string) {
  queryStore.queryText = aql;
  void router.push("/aql");
}
</script>

<template>
  <div class="view-browser">
    <div v-if="!serverStore.activeServerId" class="empty-state full">
      <h3>No server selected</h3>
      <p>Select a Better Platform server to browse its views.</p>
    </div>

    <div v-else-if="!isBetter" class="empty-state full">
      <h3>Views are a Better Platform feature</h3>
      <p>
        The active server profile's type is {{ serverTypeName }}. Views are only available on
        servers of type Better Platform. Check the profile's server type in
        <router-link to="/servers">Server Manager</router-link>.
      </p>
    </div>

    <template v-else>
      <div class="panel-left">
        <div class="panel-header">
          <h2>Views</h2>
          <RefreshButton title="Refresh views" :loading="viewStore.listLoading" @click="loadList" />
        </div>
        <div class="search-bar">
          <label for="view-filter-input" class="sr-only">Filter views</label>
          <input
            id="view-filter-input"
            v-model="filterText"
            class="input search-input"
            placeholder="Filter views by name or description..."
          />
        </div>

        <div v-if="viewStore.listLoading && viewStore.views.length === 0" class="loading">
          Loading views...
        </div>
        <div v-else-if="viewStore.listError" class="error-msg">{{ viewStore.listError }}</div>
        <div v-else-if="visibleViews.length === 0" class="empty-hint">No views match.</div>

        <button
          v-for="v in visibleViews"
          :key="v.name"
          type="button"
          class="view-item"
          :class="{ active: v.name === name }"
          @click="openView(v)"
        >
          <span class="view-name">{{ v.name }}</span>
          <span v-if="v.description" class="view-meta">{{ v.description }}</span>
          <span v-if="v.steps.length" class="view-steps">{{ v.steps.join(" → ") }}</span>
        </button>
      </div>

      <div class="panel-right">
        <div v-if="!name" class="empty-state">
          <p>Select a view to see its definition.</p>
        </div>
        <div v-else-if="viewStore.viewLoading" class="loading">Loading view...</div>
        <div v-else-if="viewStore.viewError" class="error-msg">{{ viewStore.viewError }}</div>

        <template v-else-if="view">
          <div class="panel-header view-header">
            <h2>{{ view.name }}</h2>
            <p class="facts">
              <template v-if="view.category">{{ view.category }} · </template>
              {{ view.steps.length }} step{{ view.steps.length === 1 ? "" : "s" }}
            </p>
            <p v-if="view.description" class="description">{{ view.description }}</p>
          </div>

          <section class="section">
            <h3>Parameters</h3>
            <p v-if="view.parameters.length === 0" class="empty-hint inline">
              No parameters declared.
            </p>
            <table v-else class="param-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Format</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in view.parameters" :key="p.name">
                  <td class="mono">{{ p.name }}</td>
                  <td>{{ p.param_type ?? "" }}</td>
                  <td>{{ p.format ?? "" }}</td>
                  <td>{{ p.description ?? "" }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="section">
            <h3>Steps</h3>
            <ViewStepList :steps="view.steps" @open-in-aql="openInAqlRunner" />
          </section>

          <CollapsibleSection title="Raw JSON" summary="as downloaded from the admin console">
            <CopyButton :text="rawText" title="Copy view definition" />
            <div class="json-box">
              <JsonViewer :value="view.raw" :default-collapsed-depth="2" />
            </div>
          </CollapsibleSection>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.view-browser {
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
  gap: 12px;
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
.view-header {
  flex-direction: column;
  align-items: stretch;
  padding: 16px 0;
  gap: 4px;
}
.facts,
.description {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.search-bar {
  padding: 8px 16px;
}
.search-input {
  width: 100%;
}

.view-item {
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
.view-item:hover {
  background: var(--color-surface);
}
.view-item.active {
  background: var(--color-bg-tertiary);
}
.view-item:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
.view-name {
  font-size: 13px;
}
.view-meta {
  font-size: 11px;
  color: var(--color-text-secondary);
}
.view-steps {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
}

.section h3 {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}
.param-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.param-table th {
  text-align: left;
  font-weight: 600;
  color: var(--color-text-secondary);
  padding: 4px 6px;
  border-bottom: 1px solid var(--color-border);
}
.param-table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
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
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
.empty-hint.inline {
  padding: 0;
}
.error-msg {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--color-error);
  overflow-wrap: anywhere;
}
</style>
