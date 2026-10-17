<script setup lang="ts">
// A Better form's environment (PRD-0020): its variables, and the external
// APIs it calls at runtime with each call's method, URL, parameters and
// sample response — e.g. the "Zorica Terminologies" code-list lookups.
import CollapsibleSection from "./CollapsibleSection.vue";
import JsonViewer from "./JsonViewer.vue";
import type { EnvironmentModel } from "../lib/forms";

defineProps<{
  model: EnvironmentModel;
}>();
</script>

<template>
  <div class="form-environment">
    <p v-if="model.variables.length === 0 && model.apis.length === 0" class="empty">
      This form defines no variables or external APIs.
    </p>

    <section v-if="model.variables.length > 0">
      <h4>Variables</h4>
      <table class="env-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Type</th>
            <th scope="col">Source</th>
            <th scope="col">Mandatory</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in model.variables" :key="v.name">
            <td class="mono">{{ v.name }}</td>
            <td>{{ v.type ?? "" }}</td>
            <td>{{ v.source ?? "" }}</td>
            <td>{{ v.mandatory ? "yes" : "no" }}</td>
            <td class="mono">{{ v.value || "—" }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-for="api in model.apis" :key="api.name" class="api">
      <h4>
        {{ api.name }}
        <span class="meta">authentication: {{ api.authType ?? "unknown" }}</span>
      </h4>
      <table v-if="api.calls.length > 0" class="env-table">
        <thead>
          <tr>
            <th scope="col">Call</th>
            <th scope="col">Method</th>
            <th scope="col">URL</th>
            <th scope="col">Path parameters</th>
            <th scope="col">Query parameters</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="call in api.calls" :key="call.name">
            <td>{{ call.name }}</td>
            <td class="mono">{{ call.method ?? "" }}</td>
            <td class="mono">{{ call.url ?? "" }}</td>
            <td class="mono">
              <div v-for="(value, key) in call.pathParams" :key="key">{{ key }} = {{ value }}</div>
            </td>
            <td class="mono">
              <div v-for="p in call.parameters" :key="p.name">{{ p.name }} = {{ p.value }}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <CollapsibleSection
        v-for="call in api.calls.filter((c) => c.sampleResponse !== null)"
        :key="`${call.name}-sample`"
        :title="`Sample response: ${call.name}`"
      >
        <JsonViewer :value="call.sampleResponse" :default-collapsed-depth="2" />
      </CollapsibleSection>
    </section>
  </div>
</template>

<style scoped>
.form-environment {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 12px;
}
h4 {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}
.meta {
  margin-left: 8px;
  font-weight: 400;
  color: var(--color-text-secondary);
}
.empty {
  color: var(--color-text-secondary);
}
.env-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 6px;
}
.env-table th {
  text-align: left;
  font-weight: 600;
  color: var(--color-text-secondary);
  padding: 4px 6px;
  border-bottom: 1px solid var(--color-border);
}
.env-table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
  overflow-wrap: anywhere;
}
.mono {
  font-family: var(--font-mono);
  font-size: 11px;
}
</style>
