import { defineStore } from "pinia";
import { ref } from "vue";
import { getView, listViews, type ViewDefinition, type ViewSummary } from "../lib/views";

// Better Platform views (PRD-0021): the view list for the active server and
// the view currently open in the Views section.
export const useViewStore = defineStore("view", () => {
  const views = ref<ViewSummary[]>([]);
  const listLoading = ref(false);
  const listError = ref<string | null>(null);

  const selected = ref<ViewDefinition | null>(null);
  const viewLoading = ref(false);
  const viewError = ref<string | null>(null);

  // A slow response for a view (or server) the user has since left must not
  // overwrite the newer one — same guard as the form store.
  let listRequestId = 0;
  let viewRequestId = 0;

  async function fetchViews(serverId: string) {
    const requestId = ++listRequestId;
    listLoading.value = true;
    listError.value = null;
    try {
      const result = await listViews(serverId);
      if (requestId === listRequestId) views.value = result;
    } catch (e) {
      if (requestId === listRequestId) {
        views.value = [];
        listError.value = String(e);
      }
    } finally {
      if (requestId === listRequestId) listLoading.value = false;
    }
  }

  async function fetchView(serverId: string, name: string) {
    const requestId = ++viewRequestId;
    viewLoading.value = true;
    viewError.value = null;
    selected.value = null;
    try {
      const view = await getView(serverId, name);
      if (requestId === viewRequestId) selected.value = view;
    } catch (e) {
      if (requestId === viewRequestId) viewError.value = String(e);
    } finally {
      if (requestId === viewRequestId) viewLoading.value = false;
    }
  }

  function clear() {
    listRequestId++;
    viewRequestId++;
    views.value = [];
    selected.value = null;
    listError.value = null;
    viewError.value = null;
    listLoading.value = false;
    viewLoading.value = false;
  }

  return {
    views,
    listLoading,
    listError,
    selected,
    viewLoading,
    viewError,
    fetchViews,
    fetchView,
    clear,
  };
});
