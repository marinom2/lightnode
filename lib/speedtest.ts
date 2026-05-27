/**
 * Parse the Speed test (benchmark) command's streamed output into a structured
 * result the UI can render as a dial. Returns null until the run has produced
 * the worst-case + deadline figures (i.e. it finished), so the caller can keep
 * showing the live log meanwhile.
 */
export type SpeedVerdict = "comfortable" | "tight" | "over";

export interface SpeedTestResult {
  model?: string;
  decodeToks: number; // token decode throughput (tok/s)
  prefillToks: number; // prompt prefill throughput (tok/s)
  coldLoadS: number; // cold model-load time (s)
  worstS: number; // projected worst-case full job (s)
  deadlineS: number; // on-chain job deadline (s)
  verdict: SpeedVerdict;
}

function firstNumber(out: string, re: RegExp): number {
  const m = out.match(re);
  return m ? Number(m[1]) : NaN;
}

export function parseSpeedTest(out: string): SpeedTestResult | null {
  const decodeToks = firstNumber(out, /decode:\s*([\d.]+)\s*tok\/s/i);
  const prefillToks = firstNumber(out, /prefill:\s*([\d.]+)\s*tok\/s/i);
  const coldLoadS = firstNumber(out, /cold load:\s*([\d.]+)\s*s/i);
  const worstS = firstNumber(out, /worst-case job[^~]*~\s*([\d.]+)\s*s/i);
  const deadlineS = firstNumber(out, /deadline\s*([\d.]+)\s*s/i);

  // Not finished until we have the projection + the deadline to compare against.
  if (!Number.isFinite(worstS) || !Number.isFinite(deadlineS) || !Number.isFinite(decodeToks)) return null;

  let verdict: SpeedVerdict;
  if (/comfortably within/i.test(out)) verdict = "comfortable";
  else if (/within the deadline but tight/i.test(out)) verdict = "tight";
  else if (/over the .* deadline|high risk/i.test(out)) verdict = "over";
  else verdict = worstS < deadlineS * 0.7 ? "comfortable" : worstS < deadlineS ? "tight" : "over";

  const modelMatch = out.match(/benchmarking\s+(\S+)/i);

  return {
    model: modelMatch?.[1],
    decodeToks,
    prefillToks: Number.isFinite(prefillToks) ? prefillToks : decodeToks,
    coldLoadS: Number.isFinite(coldLoadS) ? coldLoadS : 0,
    worstS,
    deadlineS,
    verdict,
  };
}
