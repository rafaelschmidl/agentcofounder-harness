import { describe, expect, it, vi } from "vitest";
import { Ajv } from "ajv";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import repairCompletion from "../solution/extensions/repair-completion.js";
import { buildBuilderPiArguments, buildRepairPiArguments } from "../src/builder.js";
import { compileProductSpec } from "../src/build-plan/compile.js";
import { validProductSpec } from "./fixtures/product-spec.js";

describe("repair completion tool", () => {
  it("returns an explicit verification handoff without claiming a pass", async () => {
    const api = { registerTool: vi.fn() };
    repairCompletion(api as unknown as ExtensionAPI);
    const tool = api.registerTool.mock.calls.map(([registered]) => registered).find((registered) => registered.name === "finish_repair") as {
      name: string;
      execute(id: string, params: { summary: string }): Promise<{ terminate: boolean; details: { handoff: string; summary: string }; content: Array<{ text: string }> }>;
    };
    expect(tool.name).toBe("finish_repair");
    const result = await tool.execute("done", { summary: "Scoped the ambiguous selectors in the supplied failing assertions." });
    expect(result.terminate).toBe(true);
    expect(result.details.handoff).toBe("verification");
    expect(result.content[0]?.text).toContain("No pass is claimed");
  });

  it("exposes completion only in the repair session", () => {
    const spec = validProductSpec();
    const plan = compileProductSpec(spec);
    const repair = buildRepairPiArguments(spec, plan, "repair", "interfaces", "/repair", 1);
    const builder = buildBuilderPiArguments(spec, plan, "builder", "interfaces", "/builder");
    expect(repair[repair.indexOf("--tools") + 1]).toBe("write,edit,finish_repair");
    expect(repair.some((argument) => argument.endsWith("/repair-completion.ts"))).toBe(true);
    expect(repair.at(-1)).toContain("call finish_repair");
    expect(builder.some((argument) => argument.endsWith("/repair-completion.ts"))).toBe(false);
    expect(builder[builder.indexOf("--tools") + 1]).toBe("write");
  });

  it("accepts a detailed repair handoff instead of spending calls shortening it", () => {
    const api = { registerTool: vi.fn() };
    repairCompletion(api as unknown as ExtensionAPI);
    const tool = api.registerTool.mock.calls.map(([registered]) => registered).find((registered) => registered.name === "finish_repair") as { parameters: object };
    const validate = new Ajv().compile(tool.parameters);
    const summary = "Fixed the storage fixture, scoped the borrower input to its book row, and preserved the persistence and validation assertions. ".repeat(4);
    expect(summary.length).toBeGreaterThan(300);
    expect(validate({ summary })).toBe(true);
    expect(validate({ summary: 42 })).toBe(false);
  });
});
