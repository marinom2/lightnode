import { describe, it, expect } from "vitest";
import { parseAgentOutput } from "../../sdk/src/agent";

describe("parseAgentOutput", () => {
  it("parses a clean <answer> tag as the final answer", () => {
    const out = parseAgentOutput("<answer>42</answer>");
    expect(out.kind).toBe("answer");
    if (out.kind === "answer") expect(out.text).toBe("42");
  });

  it("parses an <answer> tag missing the closing brace as best-effort", () => {
    const out = parseAgentOutput("<answer>hello");
    expect(out.kind).toBe("answer");
    if (out.kind === "answer") expect(out.text).toBe("hello");
  });

  it("parses a <tool> call with JSON args", () => {
    const out = parseAgentOutput('<tool>add {"a":17,"b":25}</tool>');
    expect(out.kind).toBe("tool_call");
    if (out.kind === "tool_call") {
      expect(out.name).toBe("add");
      expect(out.args).toEqual({ a: 17, b: 25 });
    }
  });

  it("recovers when the tool call has malformed JSON (empty args)", () => {
    const out = parseAgentOutput("<tool>add {not json}</tool>");
    expect(out.kind).toBe("tool_call");
    if (out.kind === "tool_call") {
      expect(out.name).toBe("add");
      expect(out.args).toEqual({});
    }
  });

  it("treats unrecognized output as a thought", () => {
    const out = parseAgentOutput("I should probably use the add tool now.");
    expect(out.kind).toBe("thought");
  });

  it("prefers <answer> over an earlier <tool> tag in the same output", () => {
    const out = parseAgentOutput('<tool>foo {}</tool>\n<answer>done</answer>');
    expect(out.kind).toBe("answer");
    if (out.kind === "answer") expect(out.text).toBe("done");
  });
});
