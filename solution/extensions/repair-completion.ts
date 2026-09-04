import { createEditToolDefinition, createWriteToolDefinition, defineTool, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";

export default function repairCompletion(pi: ExtensionAPI) {
  let handedOff = false;
  function withHandoff<TParameters extends TSchema, TDetails>(tool: ToolDefinition<TParameters, TDetails>) {
    return {
      ...tool,
      async execute(...args: Parameters<typeof tool.execute>) {
        // Preserve native failures. An unsuccessful edit must remain an error,
        // even when another call in its batch requests a verification handoff.
        const result = await tool.execute(...args);
        return {
          ...result,
          // Pi reads every result's flag after the complete batch drains.
          get terminate() { return handedOff; },
        };
      },
    };
  }
  pi.registerTool(withHandoff(createWriteToolDefinition(process.cwd())));
  pi.registerTool(withHandoff(createEditToolDefinition(process.cwd())));
  pi.registerTool(defineTool({
    name: "finish_repair",
    label: "Return repair to verification",
    description: "Finish this repair attempt and return control to the harness, which will run the actual tests/build. Call after the necessary edits, or when the supplied evidence cannot justify further changes. This does not claim that the repair passed.",
    parameters: Type.Object({ summary: Type.String({ description: "Brief summary of the changes ready for verification." }) }, { additionalProperties: false }),
    async execute(_id, { summary }) {
      handedOff = true;
      return {
        content: [{ type: "text", text: "Repair handed back to deterministic verification. No pass is claimed." }],
        details: { handoff: "verification", summary },
        terminate: true,
      };
    },
  }));
}
