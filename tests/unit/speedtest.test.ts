import { describe, it, expect } from "vitest";
import { parseSpeedTest } from "@/lib/speedtest";

const OVER = `▶ benchmarking llama3-8b (real inference vs the 120s job deadline)...
  forcing a cold start (worst case: a job hitting an idle worker)...
  running a representative judging prompt...
✓ decode: 8.4 tok/s · prefill: 92 tok/s · cold load: 11.9s
  worst-case job (cold load + 2048-token prompt + 1024-token answer): ~157s  (deadline 120s)
⛔ over the 120s deadline - high risk of timed-out jobs (slash). Use a faster GPU or a lighter model.`;

const COMFORTABLE = `▶ benchmarking llama3-8b (real inference vs the 120s job deadline)...
✓ decode: 65.0 tok/s · prefill: 800 tok/s · cold load: 3.0s
  worst-case job (cold load + 2048-token prompt + 1024-token answer): ~29s  (deadline 120s)
✅ comfortably within the 120s deadline - low slash risk`;

describe("parseSpeedTest", () => {
  it("parses a finished over-deadline run", () => {
    const r = parseSpeedTest(OVER)!;
    expect(r).not.toBeNull();
    expect(r.model).toBe("llama3-8b");
    expect(r.decodeToks).toBe(8.4);
    expect(r.prefillToks).toBe(92);
    expect(r.coldLoadS).toBe(11.9);
    expect(r.worstS).toBe(157);
    expect(r.deadlineS).toBe(120);
    expect(r.verdict).toBe("over");
  });
  it("parses a comfortable run", () => {
    const r = parseSpeedTest(COMFORTABLE)!;
    expect(r.verdict).toBe("comfortable");
    expect(r.worstS).toBe(29);
  });
  it("returns null until the worst-case + deadline line has streamed in", () => {
    expect(parseSpeedTest("▶ benchmarking llama3-8b ...\n  running a representative judging prompt...")).toBeNull();
  });
});
