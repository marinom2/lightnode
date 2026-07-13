import { describe, it, expect } from "vitest";
import { actionableProposals, newAlerts, voteNotification, type VoteAlert } from "./dao-alerts";
import type { ProposalView } from "./governance";

function prop(over: Partial<ProposalView>): ProposalView {
  return {
    id: "1",
    title: "Proposal",
    description: "",
    proposer: "0x0",
    state: "active",
    forVotes: 0,
    againstVotes: 0,
    abstainVotes: 0,
    deadlineBlock: "0",
    blocksLeft: 100,
    youVoted: false,
    yourWeight: 10,
    actions: [],
    ...over,
  };
}

describe("actionableProposals", () => {
  it("keeps only active, unvoted proposals with weight", () => {
    const rows = [
      prop({ id: "1", title: "Open + can vote" }),
      prop({ id: "2", state: "defeated" }), // not active
      prop({ id: "3", youVoted: true }), // already voted
      prop({ id: "4", yourWeight: 0 }), // no power
    ];
    const out = actionableProposals(rows);
    expect(out.map((a) => a.id)).toEqual(["1"]);
    expect(out[0]).toMatchObject({ title: "Open + can vote", blocksLeft: 100 });
  });
});

describe("newAlerts", () => {
  it("filters out already-notified ids", () => {
    const alerts: VoteAlert[] = [
      { id: "1", title: "a", blocksLeft: 1 },
      { id: "2", title: "b", blocksLeft: 1 },
    ];
    expect(newAlerts(alerts, ["1"]).map((a) => a.id)).toEqual(["2"]);
    expect(newAlerts(alerts, ["1", "2"])).toEqual([]);
    expect(newAlerts(alerts, []).map((a) => a.id)).toEqual(["1", "2"]);
  });
});

describe("voteNotification", () => {
  it("returns null when nothing is actionable", () => {
    expect(voteNotification([])).toBeNull();
  });
  it("names the single open proposal", () => {
    const n = voteNotification([{ id: "1", title: "Fund grants", blocksLeft: 5 }]);
    expect(n!.message).toContain("Fund grants");
  });
  it("summarizes multiple", () => {
    const n = voteNotification([
      { id: "1", title: "a", blocksLeft: 1 },
      { id: "2", title: "b", blocksLeft: 1 },
    ]);
    expect(n!.message).toContain("2 proposals");
  });
});
