import { describe, expect, it } from "vitest";
import { PiResponseBudget, PiToolBudget, summarizeEventLine } from "../src/pi-runner.js";

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
});
