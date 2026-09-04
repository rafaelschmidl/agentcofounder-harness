import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function repairCompletion(pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "finish_repair",
    label: "Return repair to verification",
    description: "Finish this repair attempt and return control to the harness, which will run the actual tests/build. Call after the necessary edits, or when the supplied evidence cannot justify further changes. This does not claim that the repair passed.",
    parameters: Type.Object({ summary: Type.String({ minLength: 1, maxLength: 300 }) }, { additionalProperties: false }),
    async execute(_id, { summary }) {
      return {
        content: [{ type: "text", text: "Repair handed back to deterministic verification. No pass is claimed." }],
        details: { handoff: "verification", summary },
        terminate: true,
      };
    },
  }));
}
