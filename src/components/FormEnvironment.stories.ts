import type { Meta, StoryObj } from "@storybook/vue3-vite";
import FormEnvironment from "./FormEnvironment.vue";
import { environmentModel } from "../lib/forms";

const meta: Meta<typeof FormEnvironment> = {
  title: "Components/FormEnvironment",
  component: FormEnvironment,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof FormEnvironment>;

// Trimmed from the real Anamnesis form's environment on a Better CDR.
export const ZoricaTerminologies: Story = {
  args: {
    model: environmentModel({
      variables: [
        {
          name: "ehrId",
          type: "string",
          source: "EXTERNALLY_PROVIDED",
          mandatory: false,
          value: "",
        },
        {
          name: "terminologyUrl",
          type: "string",
          source: "EXTERNALLY_PROVIDED",
          mandatory: false,
          value: "",
        },
      ],
      externalApis: [
        {
          name: "Zorica Terminologies",
          authentication: { type: "None" },
          calls: [
            {
              name: "getTerminology",
              requestMethod: "GET",
              url: "terminologyUrl",
              bodyType: "JSON",
              pathParams: { "{codeSystem}": "Z_lymph_nodes" },
              parameters: [],
              sampleResponse: {
                items: [{ code: "1", description: "Pelvične bezgavke", user_code: "Z00" }],
                lastPage: true,
              },
            },
            {
              name: "Request type B00",
              requestMethod: "GET",
              url: "terminologyQueryUrl",
              bodyType: "JSON",
              pathParams: { "{codeSystem}": "AD_transport_medium" },
              parameters: [
                { name: "meta.language", value: "%formLanguage%" },
                { name: "request_type", value: "B00" },
              ],
            },
          ],
        },
      ],
    }),
  },
};

export const Empty: Story = {
  args: { model: environmentModel(null) },
};
