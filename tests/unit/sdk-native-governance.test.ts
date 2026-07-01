import { describe, it, expect } from "vitest";
import { NativeGovernance, type NativeGovClient } from "../../sdk/src/index";
import { NETWORKS } from "../../sdk/src/networks";

const M = NETWORKS.mainnet;
const EOA = "0x8a35E00eff6f3bf125aE5011cc7C603E18B8D616" as `0x${string}`;
const e18 = (n: number) => BigInt(n) * 10n ** 18n;

// Live-ish fixture values (mirrors what the mainnet contracts return).
const PAST_TOTAL = 9_966_500_000n * 10n ** 18n; // getPastTotalSupply
const TREASURY_VOTES = 4_500_000_008n * 10n ** 18n;
const WR_BALANCE = e18(760_000);
const FEEPOOL_VOTES = e18(24);
const SLASHED = e18(25_000);
// Live behaviour: quorum = 3% of (pastTotalSupply - net worker stake).
const NET_STAKE = WR_BALANCE - SLASHED; // 735,000
const QUORUM_NOW = ((PAST_TOTAL - NET_STAKE) * 3n) / 100n;

const lc = (a: string) => a.toLowerCase();

function makeClient(): NativeGovClient {
  const votesByAddr: Record<string, bigint> = {
    [lc(M.treasury!)]: TREASURY_VOTES,
    [lc(M.workerRegistry)]: WR_BALANCE,
    [lc(M.feePool!)]: FEEPOOL_VOTES,
  };
  const ownerByAddr: Record<string, `0x${string}`> = {
    [lc(M.treasury!)]: M.timelock as `0x${string}`, // treasury owned by timelock (DAO)
    [lc(M.aiConfig)]: EOA,
    [lc(M.workerRegistry)]: EOA,
    [lc(M.jobRegistry)]: EOA,
  };
  return {
    async readContract({ address, functionName, args }) {
      const a0 = args?.[0];
      switch (functionName) {
        case "proposalThreshold": return e18(140_000);
        case "quorumNumerator": return 3n;
        case "quorumDenominator": return 100n;
        case "quorum": return QUORUM_NOW;
        case "votingDelay": return 14_400n;
        case "votingPeriod": return 100_800n;
        case "clock": return 817_168n;
        case "timelock": return M.timelock;
        case "getMinDelay": return 172_800n;
        case "getPastTotalSupply": return PAST_TOTAL;
        case "getTotalVotingPower": return PAST_TOTAL - NET_STAKE; // Governor's staked-excluded base
        case "getVotes": return votesByAddr[lc(String(a0))] ?? 0n;
        case "getSlashedFunds": return SLASHED;
        case "PROPOSER_ROLE": return "0x01".padEnd(66, "0");
        case "EXECUTOR_ROLE": return "0x02".padEnd(66, "0");
        case "DEFAULT_ADMIN_ROLE": return "0x00".padEnd(66, "0");
        case "hasRole": return true; // gov=proposer, executor open, self-admin
        case "owner": return ownerByAddr[lc(address)] ?? "0x0000000000000000000000000000000000000000";
        default: return 0n;
      }
    },
    async getBalance({ address }) {
      const b: Record<string, bigint> = {
        [lc(M.workerRegistry)]: WR_BALANCE,
        [lc(M.treasury!)]: TREASURY_VOTES,
        [lc(M.feePool!)]: FEEPOOL_VOTES,
      };
      return b[lc(address)] ?? 0n;
    },
  };
}

describe("NativeGovernance", () => {
  it("config: reads live threshold + quorum fraction", async () => {
    const g = new NativeGovernance("mainnet", makeClient());
    const c = await g.config();
    expect(c.proposalThresholdLcai).toBe(140_000);
    expect(c.quorumFractionPct).toBe(3);
    expect(c.timelockMinDelaySec).toBe(172_800n);
  });

  it("supply: worker stake is excluded from the quorum base (backed out from quorum())", async () => {
    const g = new NativeGovernance("mainnet", makeClient());
    const s = await g.supply();
    // QUORUM_NOW = 3% of (PAST_TOTAL - worker stake), so the backed-out base
    // must equal PAST_TOTAL minus the excluded stake, and the excluded amount
    // must equal the net worker stake.
    const netStake = WR_BALANCE - SLASHED; // 735,000
    expect(s.quorumExcludesWorkerStake).toBe(true);
    expect(s.workerStakeExcludedWei).toBe(netStake);
    expect(s.quorumBaseWei).toBe(PAST_TOTAL - netStake);
    // Treasury/FeePool are still IN the base but non-castable; worker stake is not here.
    expect(s.nonCastable.map((h) => h.label)).toEqual(["Treasury", "FeePool"]);
    expect(s.nonCastableTotalWei).toBe(TREASURY_VOTES + FEEPOOL_VOTES);
    expect(s.castableSupplyWei).toBe(s.quorumBaseWei - (TREASURY_VOTES + FEEPOOL_VOTES));
    expect(s.quorumPctOfCastable).toBeGreaterThan(3);
  });

  it("workerStake: total staked = registry balance minus unwithdrawn slashed funds", async () => {
    const g = new NativeGovernance("mainnet", makeClient());
    const w = await g.workerStake();
    expect(w.totalStakedWei).toBe(WR_BALANCE - SLASHED);
    expect(w.totalStakedLcai).toBe(735_000);
    expect(w.nonCastable).toBe(true);
  });

  it("decentralization: treasury is DAO-controlled but the AI protocol is an EOA", async () => {
    const g = new NativeGovernance("mainnet", makeClient());
    const d = await g.decentralization();
    expect(d.treasuryDaoControlled).toBe(true);
    expect(d.protocolDaoControlled).toBe(false);
    expect(d.protocolAdminEoa?.toLowerCase()).toBe(EOA.toLowerCase());
    expect(d.governorIsProposer).toBe(true);
    expect(d.selfAdministered).toBe(true);
    expect(d.verdict).toMatch(/CENTRALIZED/);
  });
});
