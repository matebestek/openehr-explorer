<script setup lang="ts">
// The processing steps of a Better view (PRD-0021), in order: processor
// name plus its code. AQL (and FreeMarker-templated AQL) is shown in the
// read-only AQL editor for highlighting; JavaScript, FreeMarker and other
// processors as monospaced text. Plain `jsonAql` steps can be opened in the
// AQL Runner.
import AqlEditor from "./AqlEditor.vue";
import CopyButton from "./CopyButton.vue";
import { canOpenInAqlRunner, isAqlStep, type ViewStep } from "../lib/views";

defineProps<{
  steps: ViewStep[];
}>();

const emit = defineEmits<{
  "open-in-aql": [aql: string];
}>();
</script>

<template>
  <div class="view-step-list">
    <p v-if="steps.length === 0" class="empty">This view has no steps.</p>
    <section v-for="(step, i) in steps" :key="i" class="step">
      <div class="step-header">
        <span class="step-number">Step {{ i + 1 }}</span>
        <span class="step-processor">{{ step.processor_name || "(unnamed processor)" }}</span>
        <span class="step-actions">
          <button
            v-if="canOpenInAqlRunner(step)"
            type="button"
            class="btn btn-sm"
            @click="emit('open-in-aql', step.processor_data)"
          >
            Open in AQL Runner
          </button>
          <CopyButton :text="step.processor_data" :title="`Copy step ${i + 1}`" />
        </span>
      </div>
      <div v-if="isAqlStep(step)" class="aql-box">
        <AqlEditor :model-value="step.processor_data" read-only />
      </div>
      <pre v-else class="code">{{ step.processor_data || "(empty)" }}</pre>
    </section>
  </div>
</template>

<style scoped>
.view-step-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.empty {
  font-size: 12px;
  color: var(--color-text-secondary);
}
.step {
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.step-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
}
.step-number {
  font-weight: 600;
}
.step-processor {
  font-family: var(--font-mono);
  color: var(--color-text-secondary);
}
.step-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
/* AqlEditor fills its container's height. */
.aql-box {
  height: 260px;
}
.code {
  margin: 0;
  padding: 10px;
  max-height: 360px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: pre;
  color: var(--color-text);
  background: var(--color-bg-secondary);
}
</style>
