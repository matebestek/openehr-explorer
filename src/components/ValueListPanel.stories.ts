import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { fn } from "storybook/test";
import ValueListPanel from "./ValueListPanel.vue";
import type { CodedValueSelection, ValueListModel } from "../lib/valueList";

const ELEMENT_PATH =
  "/content[openEHR-EHR-OBSERVATION.tobacco_smoking_summary.v1]/data[at0001]/events[at0002]/data[at0003]/items[at0004]/value";

const smokingSelection: CodedValueSelection = {
  aqlPath: ELEMENT_PATH,
  treePath: "/content[0]/data/events[0]/data/items[0]",
  elementName: "Status kajenja",
  recorded: {
    rmType: "DV_CODED_TEXT",
    terminology: "A06_smoking",
    code: "2",
    label: "Bivši kadilec",
    ordinal: null,
  },
};

const smokingModel: ValueListModel = {
  fieldName: "Status kajenja",
  fieldDescription: "Trenutna ali pretekla raba tobaka.",
  rmType: "DV_CODED_TEXT",
  terminology: "A06_smoking",
  listOpen: false,
  valueSetUrl: null,
  options: [
    { code: "1", label: "Nekadilec", description: "Nikoli kadil", ordinal: null, bindings: [] },
    {
      code: "2",
      label: "Bivši kadilec",
      description: "Je prenehal kaditi",
      ordinal: null,
      bindings: [{ terminology: "SNOMED-CT", code: "8517006" }],
    },
    { code: "3", label: "Kadilec", description: "Trenutno kadi", ordinal: null, bindings: [] },
    { code: "4", label: "Neznano", description: null, ordinal: null, bindings: [] },
  ],
  fieldBindings: [],
  annotations: { comment: "Vprašanje ob vsakem obisku" },
};

const severityModel: ValueListModel = {
  fieldName: "Severity",
  fieldDescription: "Overall severity of the symptom.",
  rmType: "DV_ORDINAL",
  terminology: "local",
  listOpen: false,
  valueSetUrl: null,
  options: [
    { code: "at0010", label: "Mild", description: null, ordinal: 1, bindings: [] },
    { code: "at0011", label: "Moderate", description: null, ordinal: 2, bindings: [] },
    { code: "at0012", label: "Severe", description: null, ordinal: 3, bindings: [] },
  ],
  fieldBindings: [],
  annotations: {},
};

const snomedSelection: CodedValueSelection = {
  ...smokingSelection,
  elementName: "Smoking status",
  recorded: {
    rmType: "DV_CODED_TEXT",
    terminology: "SNOMED-CT",
    code: "8517006",
    label: "Ex-smoker",
    ordinal: null,
  },
};

const snomedModel: ValueListModel = {
  ...smokingModel,
  fieldName: "Smoking status",
  fieldDescription: null,
  terminology: "SNOMED-CT",
  options: [],
  annotations: {},
};

const meta: Meta<typeof ValueListPanel> = {
  title: "Components/ValueListPanel",
  component: ValueListPanel,
  tags: ["autodocs"],
  args: {
    selection: smokingSelection,
    languages: ["sl", "en"],
    language: "sl",
    templateId: "Anamnesis",
    onClose: fn(),
    "onUpdate:language": fn(),
  },
  decorators: [() => ({ template: '<div style="display:flex;height:520px"><story /></div>' })],
};

export default meta;
type Story = StoryObj<typeof ValueListPanel>;

export const LocalList: Story = {
  args: { state: { kind: "list", model: smokingModel, source: "template" } },
};

export const Ordinal: Story = {
  args: {
    selection: {
      ...smokingSelection,
      elementName: "Severity",
      recorded: {
        rmType: "DV_ORDINAL",
        terminology: "local",
        code: "at0011",
        label: "Moderate",
        ordinal: 2,
      },
    },
    languages: ["en"],
    language: "en",
    state: { kind: "list", model: severityModel, source: "template" },
  },
};

export const ExternalExpanded: Story = {
  args: {
    selection: snomedSelection,
    languages: ["en"],
    language: "en",
    state: {
      kind: "list",
      source: "terminology-server",
      model: {
        ...snomedModel,
        valueSetUrl: "http://example.org/fhir/ValueSet/smoking-status",
        options: [
          { code: "8392000", label: "Non-smoker", description: null, ordinal: null, bindings: [] },
          { code: "8517006", label: "Ex-smoker", description: null, ordinal: null, bindings: [] },
          { code: "77176002", label: "Smoker", description: null, ordinal: null, bindings: [] },
        ],
      },
    },
  },
};

export const ExternalUnavailable: Story = {
  args: {
    selection: snomedSelection,
    languages: ["en"],
    language: "en",
    state: {
      kind: "external-unavailable",
      model: snomedModel,
      reason: "The template doesn't name a value set for this field.",
      description: {
        system: "http://snomed.info/sct",
        code: "8517006",
        display: "Ex-smoker",
        designations: ["Former smoker", "Ex-smoker (finding)"],
        properties: [{ code: "inactive", value: "false" }],
      },
    },
  },
};

export const RecordedNotInList: Story = {
  args: {
    selection: {
      ...smokingSelection,
      recorded: { ...smokingSelection.recorded, code: "9", label: "Občasni kadilec" },
    },
    state: { kind: "list", model: smokingModel, source: "template" },
  },
};

export const NotMatched: Story = {
  args: {
    state: { kind: "unavailable", reason: "This value's field was not found in the template." },
  },
};

export const Loading: Story = {
  args: { state: { kind: "loading" } },
};
