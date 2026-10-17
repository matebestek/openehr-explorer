import { defineStore } from "pinia";
import { ref } from "vue";
import { getForm, groupForms, listForms, type FormDefinition, type FormGroup } from "../lib/forms";

// Better Platform forms (PRD-0020): the per-name form list for the active
// server and the form version currently open in the Forms view.
export const useFormStore = defineStore("form", () => {
  const groups = ref<FormGroup[]>([]);
  const listLoading = ref(false);
  const listError = ref<string | null>(null);

  const selected = ref<FormDefinition | null>(null);
  const formLoading = ref(false);
  const formError = ref<string | null>(null);

  // A slow response for a form (or server) the user has since moved away
  // from must not overwrite the newer one — same guard as fetchEhrs.
  let listRequestId = 0;
  let formRequestId = 0;

  async function fetchForms(serverId: string) {
    const requestId = ++listRequestId;
    listLoading.value = true;
    listError.value = null;
    try {
      const entries = await listForms(serverId);
      if (requestId === listRequestId) groups.value = groupForms(entries);
    } catch (e) {
      if (requestId === listRequestId) {
        groups.value = [];
        listError.value = String(e);
      }
    } finally {
      if (requestId === listRequestId) listLoading.value = false;
    }
  }

  async function fetchForm(serverId: string, name: string, version: string) {
    const requestId = ++formRequestId;
    formLoading.value = true;
    formError.value = null;
    selected.value = null;
    try {
      const form = await getForm(serverId, name, version);
      if (requestId === formRequestId) selected.value = form;
    } catch (e) {
      if (requestId === formRequestId) formError.value = String(e);
    } finally {
      if (requestId === formRequestId) formLoading.value = false;
    }
  }

  function clear() {
    listRequestId++;
    formRequestId++;
    groups.value = [];
    selected.value = null;
    listError.value = null;
    formError.value = null;
    listLoading.value = false;
    formLoading.value = false;
  }

  return {
    groups,
    listLoading,
    listError,
    selected,
    formLoading,
    formError,
    fetchForms,
    fetchForm,
    clear,
  };
});
