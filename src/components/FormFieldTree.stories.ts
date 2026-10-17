import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { fn } from "storybook/test";
import FormFieldTree from "./FormFieldTree.vue";
import { buildFieldTree, type FieldNode } from "../lib/forms";

// Trimmed from the real Anamnesis form (1.0.157) on a Better CDR.
const description = {
  id: "anamnesis",
  name: "Anamnesis",
  rmType: "COMPOSITION",
  defaultLanguage: "en",
  localizedNames: { en: "Anamnesis", sl: "Anamneza" },
  children: [
    {
      id: "source",
      formId: "anamnesis/context/source",
      name: "Source",
      localizedNames: { en: "Source", sl: "Vir anamneze" },
      rmType: "DV_TEXT",
      min: 1,
      inputs: [{ suffix: "code", type: "TEXT", terminology: "A02_anamnesis_source" }],
    },
    {
      id: "tobacco_smoking_summary",
      formId: "anamnesis/tobacco_smoking_summary",
      name: "Tobacco smoking summary",
      localizedNames: { en: "Tobacco smoking summary", sl: "Kajenje povzetek" },
      rmType: "EVALUATION",
      children: [
        {
          id: "overall_status",
          formId: "anamnesis/tobacco_smoking_summary/overall_status",
          name: "Overall status",
          localizedNames: { en: "Smoking", sl: "Kajenje" },
          rmType: "DV_CODED_TEXT",
          viewConfig: { advanced: { hidden: true, overrideLabel: true } },
          inputs: [{ suffix: "code", type: "CODED_TEXT", list: [] }],
        },
      ],
    },
    {
      id: "guideline_id",
      formId: "anamnesis/guideline_id",
      name: "Guideline ID",
      localizedNames: { en: "Guideline ID", sl: "ID smernice" },
      rmType: "DV_TEXT",
      inputs: [{ suffix: "code", type: "TEXT", terminology: "guideline" }],
      viewConfig: {
        field: { code: { readonly: true } },
        datasource: { loadRemote: true, loadRemoteUrl: "guideline" },
      },
    },
  ],
};

const tree = buildFieldTree(description, "sl") as FieldNode;

const meta: Meta<typeof FormFieldTree> = {
  title: "Components/FormFieldTree",
  component: FormFieldTree,
  tags: ["autodocs"],
  args: { tree, selectedKey: null, onSelect: fn() },
};

export default meta;
type Story = StoryObj<typeof FormFieldTree>;

export const Default: Story = {};

export const SelectedNode: Story = {
  args: { selectedKey: "anamnesis/tobacco_smoking_summary/overall_status" },
};
