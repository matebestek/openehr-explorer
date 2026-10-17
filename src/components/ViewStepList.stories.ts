import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { fn } from "storybook/test";
import ViewStepList from "./ViewStepList.vue";

const meta: Meta<typeof ViewStepList> = {
  title: "Components/ViewStepList",
  component: ViewStepList,
  tags: ["autodocs"],
  args: { "onOpen-in-aql": fn() },
};

export default meta;
type Story = StoryObj<typeof ViewStepList>;

// From the real "Anamnesis - Load last for patient" view on a Better CDR.
export const AqlStep: Story = {
  args: {
    steps: [
      {
        processor_name: "jsonAql",
        processor_data: `select
   a/uid/value as composition_id,
   e/ehr_id/value as ehr_id,
   a/context/start_time as start_time
from EHR e [ehr_id/value=:ehrId]
contains COMPOSITION a[openEHR-EHR-COMPOSITION.encounter.v1]
where a/archetype_details/template_id/value='Anamnesis'
order by start_time desc
fetch 1`,
      },
    ],
  },
};

export const MixedSteps: Story = {
  args: {
    steps: [
      {
        processor_name: "jsonFtlAql",
        processor_data: `select o/data[at0001]/events[at0006]/time/value as time
from EHR e[ehr_id/value='\${ehrId}']
contains OBSERVATION o[openEHR-EHR-OBSERVATION.blood_pressure.v1]
<#if from??>where o/data[at0001]/events[at0006]/time/value >= '\${from}'</#if>`,
      },
      {
        processor_name: "js",
        processor_data: `var result = [];\nfor (var i = 0; i < data.length; i++) {\n  result.push({ time: data[i].time });\n}\nreturn result;`,
      },
      { processor_name: "ftl", processor_data: `<#list data as row>\${row.time}</#list>` },
    ],
  },
};

export const NoSteps: Story = {
  args: { steps: [] },
};
