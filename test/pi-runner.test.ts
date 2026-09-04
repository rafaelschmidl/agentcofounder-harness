import { describe, expect, it } from "vitest";
import { PiFileCompletion, PiResponseBudget, PiToolBudget, PiToolHandoff, summarizeEventLine } from "../src/pi-runner.js";

function assistantEvent(stopReason: string, toolCalls: number): string {
  return JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason,
      usage: { input: 1, output: 1 },
      content: Array.from({ length: toolCalls }, (_, index) => ({
        type: "toolCall",
        id: `call-${index}`,
        name: "write",
      })),
    },
  });
}

function toolEnd(isError = false): string {
  return JSON.stringify({ type: "tool_execution_end", toolName: "write", isError });
}

describe("Pi response budget", () => {
  it("stops only after every tool action in the final permitted response completes", () => {
    const budget = new PiResponseBudget(2);
    expect(budget.observe(summarizeEventLine(assistantEvent("toolUse", 1)))).toBe(false);
    expect(budget.observe(summarizeEventLine(JSON.stringify({ type: "tool_execution_end" })))).toBe(false);
    expect(budget.observe(summarizeEventLine(assistantEvent("toolUse", 2)))).toBe(false);
    expect(budget.modelCalls).toBe(2);
    expect(budget.callLimitReached).toBe(true);
    expect(budget.observe(summarizeEventLine(JSON.stringify({ type: "tool_execution_end" })))).toBe(false);
    expect(budget.observe(summarizeEventLine(JSON.stringify({ type: "tool_execution_end" })))).toBe(true);
    expect(budget.safeLimitStop).toBe(true);
  });

  it("treats an output-length stop without a completed tool action as unsafe", () => {
    const budget = new PiResponseBudget(1);
    expect(budget.observe(summarizeEventLine(assistantEvent("length", 0)))).toBe(true);
    expect(budget.safeLimitStop).toBe(false);
    expect(budget.unsafeIncompleteStop).toBe(true);
  });

  it("clears an earlier incomplete stop when a later response completes a tool action", () => {
    const budget = new PiResponseBudget(2);
    expect(budget.observe(summarizeEventLine(assistantEvent("length", 0)))).toBe(false);
    expect(budget.unsafeIncompleteStop).toBe(true);
    expect(budget.observe(summarizeEventLine(assistantEvent("toolUse", 1)))).toBe(false);
    expect(budget.unsafeIncompleteStop).toBe(false);
  });

  it("stops after the configured number of successful tools and ignores failures", () => {
    const budget = new PiToolBudget(2);
    expect(budget.observe(summarizeEventLine(toolEnd(true)))).toBe(false);
    expect(budget.successfulTools).toBe(0);
    expect(budget.observe(summarizeEventLine(toolEnd()))).toBe(false);
    expect(budget.observe(summarizeEventLine(toolEnd()))).toBe(true);
    expect(budget.successfulTools).toBe(2);
    expect(budget.limitReached).toBe(true);
  });

  it("allows a naturally terminating repair to edit the same file more than twice", () => {
    const budget = new PiToolBudget();
    for (let index = 0; index < 4; index += 1) {
      expect(budget.observe(summarizeEventLine(JSON.stringify({
        type: "tool_execution_end", toolName: "edit", toolCallId: `edit-${index}`, isError: false,
      })))).toBe(false);
    }
    expect(budget.successfulTools).toBe(4);
    expect(budget.limitReached).toBe(false);
  });
});

describe("required product file completion", () => {
  it("finishes the current response before stopping when the last file is followed by a correction", () => {
    const completion = new PiFileCompletion("/app", ["src/product/styles.css"]);
    completion.observe(summarizeEventLine(assistantEvent("toolUse", 2)));
    completion.observe(summarizeEventLine(JSON.stringify({
      type: "tool_execution_start", toolName: "write", toolCallId: "style", args: { path: "src/product/styles.css" },
    })));
    expect(completion.observe(summarizeEventLine(JSON.stringify({
      type: "tool_execution_end", toolName: "write", toolCallId: "style", isError: false,
    })))).toBe(false);
    expect(completion.completedFiles).toEqual(["src/product/styles.css"]);
    completion.observe(summarizeEventLine(JSON.stringify({
      type: "tool_execution_start", toolName: "edit", toolCallId: "correction", args: { path: "src/product/App.tsx" },
    })));
    expect(completion.observe(summarizeEventLine(JSON.stringify({
      type: "tool_execution_end", toolName: "edit", toolCallId: "correction", isError: false,
    })))).toBe(true);
  });

  it("does not substitute a repeated App write for the stylesheet", () => {
    const files = ["src/product/domain.ts", "src/product/App.tsx", "src/product/product.test.tsx", "src/product/styles.css"];
    const completion = new PiFileCompletion("/app", files);
    const write = (id: string, file: string, isError = false): boolean => {
      completion.observe(summarizeEventLine(JSON.stringify({ type: "tool_execution_start", toolName: "write", toolCallId: id, args: { path: file } })));
      return completion.observe(summarizeEventLine(JSON.stringify({ type: "tool_execution_end", toolName: "write", toolCallId: id, isError })));
    };
    expect(write("one", files[0]!)).toBe(false);
    expect(write("two", files[1]!)).toBe(false);
    expect(write("three", files[1]!)).toBe(false);
    expect(write("four", files[2]!)).toBe(false);
    expect(completion.completedFiles).toHaveLength(3);
    expect(write("failed-style", files[3]!, true)).toBe(false);
    expect(write("style", "/app/src/product/styles.css")).toBe(true);
    expect(completion.completedFiles).toEqual([...files].sort());
  });

  it("requires correlated successful execution and ignores unrelated paths", () => {
    const completion = new PiFileCompletion("/app", ["src/product/App.tsx"]);
    expect(completion.observe(summarizeEventLine(JSON.stringify({ type: "tool_execution_end", toolName: "write", toolCallId: "missing-start", isError: false })))).toBe(false);
    completion.observe(summarizeEventLine(JSON.stringify({ type: "tool_execution_start", toolName: "write", toolCallId: "other", args: { path: "/other/src/product/App.tsx" } })));
    expect(completion.observe(summarizeEventLine(JSON.stringify({ type: "tool_execution_end", toolName: "write", toolCallId: "other", isError: false })))).toBe(false);
    expect(new PiFileCompletion("/app").complete).toBe(false);
  });
});

describe("explicit repair handoff", () => {
  const start = (id: string, toolName: string) => summarizeEventLine(JSON.stringify({ type: "tool_execution_start", toolCallId: id, toolName, args: {} }));
  const end = (id: string, toolName: string, isError = false) => summarizeEventLine(JSON.stringify({ type: "tool_execution_end", toolCallId: id, toolName, isError }));

  it("allows multiple edits before a successful finish_repair hands control back", () => {
    const handoff = new PiToolHandoff(["finish_repair"]);
    for (let index = 0; index < 5; index += 1) {
      handoff.observe(summarizeEventLine(assistantEvent("toolUse", 1)));
      handoff.observe(start(`edit-${index}`, "edit"));
      expect(handoff.observe(end(`edit-${index}`, "edit"))).toBe(false);
    }
    handoff.observe(summarizeEventLine(assistantEvent("toolUse", 1)));
    handoff.observe(start("finish", "finish_repair"));
    expect(handoff.observe(end("finish", "finish_repair"))).toBe(true);
    expect(handoff.completionTool).toBe("finish_repair");
  });

  it("drains a mixed final batch and ignores failed, uncorrelated, or disabled handoffs", () => {
    const handoff = new PiToolHandoff(["finish_repair"]);
    expect(handoff.observe(end("unstarted", "finish_repair"))).toBe(false);
    handoff.observe(start("failed", "finish_repair"));
    expect(handoff.observe(end("failed", "finish_repair", true))).toBe(false);
    const disabled = new PiToolHandoff();
    disabled.observe(start("disabled", "finish_repair"));
    expect(disabled.observe(end("disabled", "finish_repair"))).toBe(false);
    handoff.observe(summarizeEventLine(assistantEvent("toolUse", 2)));
    handoff.observe(start("finish", "finish_repair"));
    expect(handoff.observe(end("finish", "finish_repair"))).toBe(false);
    handoff.observe(start("last-edit", "edit"));
    expect(handoff.observe(end("last-edit", "edit"))).toBe(true);
  });
});
