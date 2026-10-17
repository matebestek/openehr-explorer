import type { Meta, StoryObj } from "@storybook/vue3-vite";
import FormLayoutOutline from "./FormLayoutOutline.vue";
import { layoutOutline } from "../lib/forms";

const meta: Meta<typeof FormLayoutOutline> = {
  title: "Components/FormLayoutOutline",
  component: FormLayoutOutline,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof FormLayoutOutline>;

// Trimmed from the real Anamnesis form's layout on a Better CDR.
export const Default: Story = {
  args: {
    lines: layoutOutline([
      {
        col: 1,
        row: 1,
        width: 12,
        height: 2,
        children: [
          {
            id: "anamnesis/context/organisation",
            rows: [
              {
                cols: [
                  {
                    width: "100%",
                    children: [
                      { id: "anamnesis/context/organisation/organisation_name" },
                      { id: "anamnesis/context/organisation/identifier" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]),
  },
};

export const Empty: Story = {
  args: { lines: [] },
};
