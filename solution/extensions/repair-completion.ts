import { readFile } from "node:fs/promises";
import path from "node:path";
import { createEditToolDefinition, createWriteToolDefinition, defineTool, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { canonicalFilePath } from "../../src/file-path.js";

export default function repairCompletion(pi: ExtensionAPI) {
  let handedOff = false;
  // Observation must not change native file-tool success or failure semantics.
  const contents = (file: string) => readFile(file).catch(() => null);
  function withHandoff<TParameters extends TSchema, TDetails>(tool: ToolDefinition<TParameters, TDetails>) {
    return {
      ...tool,
      // The before/after observation is part of the mutation contract. Pi's
      // native runtime otherwise starts every call concurrently, so an async
      // observation could let a later alias of this file enter the native
      // mutation queue first and reverse the model's edit/write order.
      executionMode: "sequential" as const,
      async execute(...args: Parameters<typeof tool.execute>) {
        const file = canonicalFilePath(path.resolve(process.cwd(), String((args[1] as { path: string }).path)));
        // Native mutations queue by path. Equivalent aliases must share the
        // same queue as well as the same ownership decision.
        args[1] = { ...args[1], path: file };
        const before = await contents(file);
        // Preserve native failures. An unsuccessful edit must remain an error,
        // even when another call in its batch requests a verification handoff.
        const result = await tool.execute(...args);
        const after = await contents(file);
        if (after !== null && (before === null || !after.equals(before))) handedOff = true;
        return {
          ...result,
          // Return after the first real mutation batch, without requiring another
          // model response to request verification. Pi reads these getters only
          // after all calls drain, including later corrections in the same batch.
          // Native errors have no flag, so mixed-error batches may need the
          // existing explicit finish_repair fallback; do not fake their success.
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
