import { describe, it, expect } from "vitest";
import { encodeAbiParameters, toEventSelector } from "viem";
import { titleFrom, parseProposalLogs, castVoteData, STATE_LABELS } from "./governance";

const SIG = "ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)";
const PROPOSER = "0x1111111111111111111111111111111111111111" as const;

// All params are non-indexed in the OZ event: data carries everything, one topic.
const TOPIC = toEventSelector(SIG);
function makeLog(id: bigint, description: string, topic = TOPIC) {
  const data = encodeAbiParameters(
    [
      { type: "uint256" }, { type: "address" }, { type: "address[]" }, { type: "uint256[]" },
      { type: "string[]" }, { type: "bytes[]" }, { type: "uint256" }, { type: "uint256" }, { type: "string" },
    ],
    [id, PROPOSER, [], [], [], [], 100n, 200n, description],
  );
  return { data, topics: [topic] };
}

describe("parseProposalLogs", () => {
  it("decodes a real ProposalCreated log", () => {
    const log = makeLog(42n, "# Fund the grants round\nDetails follow.");
    const out = parseProposalLogs({ items: [log] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "42", proposer: PROPOSER });
    expect(out[0]!.description).toContain("grants round");
  });
  it("skips foreign events and junk without throwing", () => {
    const good = makeLog(7n, "Treasury top-up");
    const junk = [{ data: "0xdeadbeef", topics: ["0x" + "11".repeat(32)] }, { data: 5 }, null, {}];
    const out = parseProposalLogs({ items: [good, ...junk] as never });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("7");
    expect(parseProposalLogs(null)).toEqual([]);
  });
  it("filters by topic0 so VoteCast logs with the right shape are not misread", () => {
    // Same data layout, different event topic -> must be ignored, not decoded.
    const voteCast = makeLog(99n, "not a proposal", ("0x" + "ab".repeat(32)) as `0x${string}`);
    const real = makeLog(3n, "Real proposal");
    const out = parseProposalLogs({ items: [voteCast, real] });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("3");
  });
});

describe("titleFrom", () => {
  it("takes the first non-empty line, strips markdown heading marks", () => {
    expect(titleFrom("\n\n## Upgrade the fee module\nbody", "1")).toBe("Upgrade the fee module");
  });
  it("falls back to the id and clamps long titles", () => {
    expect(titleFrom("", "123456789012")).toBe("Proposal #12345678");
    expect(titleFrom("x".repeat(200), "1").length).toBeLessThanOrEqual(90);
  });
  it("strips bidi control characters", () => {
    expect(titleFrom("‮evil title", "1")).toBe("evil title");
  });
});

describe("castVoteData", () => {
  it("encodes castVote(id, support) with the right selector", () => {
    const data = castVoteData("42", 1);
    expect(data.startsWith("0x56781388")).toBe(true); // castVote(uint256,uint8)
    expect(data).toContain("2a".padStart(64, "0")); // id 42
  });
});

describe("STATE_LABELS", () => {
  it("matches the OZ Governor v5 state enum order", () => {
    expect(STATE_LABELS).toEqual(["pending", "active", "canceled", "defeated", "succeeded", "queued", "expired", "executed"]);
  });
});
