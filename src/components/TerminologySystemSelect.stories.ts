import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { ref } from "vue";
import { expect, userEvent, within } from "storybook/test";
import TerminologySystemSelect from "./TerminologySystemSelect.vue";

const meta: Meta<typeof TerminologySystemSelect> = {
  title: "Components/TerminologySystemSelect",
  component: TerminologySystemSelect,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Terminology system picker used across the Terminology Browser's tabs. A SearchableSelect over the common systems the backend recognises by name (SNOMED CT, LOINC, ICD-10, ICD-11, ATC), each shown with its canonical URI, plus a 'Custom…' option that reveals a free-text field for anything else — a raw canonical system URI, a national extension, or an identifier the dropdown doesn't know about. Replaces a plain `<input list>` datalist, which gives no visible affordance that suggestions exist.",
      },
    },
  },
  render: (args) => ({
    components: { TerminologySystemSelect },
    setup() {
      const value = ref(args.modelValue);
      return { value, label: args.label };
    },
    template: `<TerminologySystemSelect v-model="value" :label="label" />`,
  }),
  args: {
    modelValue: "SNOMED-CT",
    label: "Terminology system",
  },
};

export default meta;
type Story = StoryObj<typeof TerminologySystemSelect>;

/** A known system is selected in the dropdown; no custom field is shown. */
export const KnownSystem: Story = {
  args: { modelValue: "LOINC" },
};

/** A value outside the common list (a raw canonical URI, in this case) shows as "Custom…" with the text field revealed. */
export const CustomSystem: Story = {
  args: { modelValue: "http://hl7.org/fhir/sid/ndc" },
};

/** Picking "Custom…" from the dropdown reveals an empty text field to type into. */
export const SwitchToCustom: Story = {
  args: { modelValue: "SNOMED-CT" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /terminology system/i }));
    await userEvent.click(await canvas.findByText("Custom…"));
    await expect(canvas.getByPlaceholderText(/canonical system uri/i)).toBeInTheDocument();
  },
};

const localSystems = [
  { value: "A06_smoking", label: "A06_smoking", languages: ["sl", "en"] },
  { value: "Gender", label: "Spol (Gender)", languages: ["sl"] },
];

/** A local code system from the server's code-list service is selected; it's listed after the FHIR systems. */
export const LocalCodeSystem: Story = {
  args: { modelValue: "A06_smoking", localSystems },
};

/** Local code systems appear in the open dropdown, each marked as a code list with its languages. */
export const LocalSystemsListed: Story = {
  args: { modelValue: "SNOMED-CT", localSystems },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /terminology system/i }));
    await expect(await canvas.findByText("Code list · sl, en")).toBeInTheDocument();
  },
};
