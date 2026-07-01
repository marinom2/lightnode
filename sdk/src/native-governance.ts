/**
 * Native-governance module: the LightChain L1 DAO (chain 9200), as distinct
 * from the Ethereum-side LCAI token DAO wrapped by `dao.ts`.
 *
 * On LightChain the voting token is native LCAI via the NativeVotes genesis
 * predeploy (0x...1001): every account's voting power equals its native
 * balance, auto-self-delegated (no wrapping, no explicit delegate call). That
 * one fact drives everything here, and it is easy to get wrong:
 *
 *   - Protocol contracts that HOLD native LCAI (the Treasury, the
 *     WorkerRegistry stake pool, the FeePool) therefore carry voting power
 *     equal to their balance - it is counted in `getPastTotalSupply` (the
 *     quorum denominator) - yet none of them can CAST a vote. So worker stake
 *     and the treasury are non-castable voting power: they inflate the quorum
 *     denominator but can never be voted. `supply()` separates the two.
 *   - Worker stake is native LCAI locked in the WorkerRegistry; the real
 *     staked total is its balance minus the unwithdrawn slashed funds still
 *     sitting in the contract. `workerStake()` computes that.
 *   - `decentralization()` answers "who actually controls what": the Treasury
 *     is Timelock-owned (DAO), but the AI-protocol registries can still be
 *     owned by an EOA. It reads owners + timelock roles and says so plainly.
 *
 * Reads only. Addresses come from `NetworkConfig` (see networks.ts), verified
 * live on 2026-07-01. Needs a publicClient exposing `readContract` and, for
 * the balance/supply reads, `getBalance` (a viem PublicClient satisfies both).
 */

import { parseAbi } from "viem";
import { NETWORKS } from "./networks.js";
import type { NetworkConfig, NetworkId } from "./types.js";

/** Structural viem client (method shorthand for bivariant assignability). */
export interface NativeGovClient {
  readContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  /** Native balance read. Required for supply()/workerStake(). */
  getBalance?(args: { address: `0x${string}` }): Promise<bigint>;
}

const GOVERNOR_ABI = parseAbi([
  "function proposalThreshold() view returns (uint256)",
  "function quorumNumerator() view returns (uint256)",
  "function quorumDenominator() view returns (uint256)",
  "function quorum(uint256 timepoint) view returns (uint256)",
  "function votingDelay() view returns (uint256)",
  "function votingPeriod() view returns (uint256)",
  "function clock() view returns (uint48)",
  "function token() view returns (address)",
  "function timelock() view returns (address)",
]);

const VOTES_ABI = parseAbi([
  "function getVotes(address account) view returns (uint256)",
  "function getPastTotalSupply(uint256 timepoint) view returns (uint256)",
  // INativeVotes extension: the staked-excluded voting supply the Governor's
  // overridden quorum() actually uses (verified in LightChainGovernor source).
  "function getTotalVotingPower(uint256 timepoint) view returns (uint256)",
]);

const TIMELOCK_ABI = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
]);

const OWNABLE_ABI = parseAbi(["function owner() view returns (address)"]);
const WORKER_REGISTRY_ABI = parseAbi(["function getSlashedFunds() view returns (uint256)"]);

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const toLcai = (wei: bigint): number => Number(wei) / 1e18;
const sameAddr = (a?: string, b?: string): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export interface NativeGovConfig {
  governor: `0x${string}`;
  timelock: `0x${string}`;
  /** NativeVotes precompile (the voting token). */
  token: `0x${string}`;
  proposalThresholdWei: bigint;
  proposalThresholdLcai: number;
  quorumNumerator: bigint;
  quorumDenominator: bigint;
  quorumFractionPct: number;
  /** Quorum in voting-weight wei, evaluated at the latest finalized clock. */
  quorumNowWei: bigint;
  quorumNowLcai: number;
  votingDelayBlocks: bigint;
  votingPeriodBlocks: bigint;
  timelockMinDelaySec: bigint;
}

export interface NonVotableHolder {
  label: string;
  address: `0x${string}`;
  votesWei: bigint;
  lcai: number;
}

export interface SupplyBreakdown {
  /** Raw getPastTotalSupply at the reference block (every account's native balance). */
  pastTotalSupplyWei: bigint;
  pastTotalSupplyLcai: number;
  /**
   * Worker stake is EXCLUDED from the quorum base: the Governor computes quorum
   * against (pastTotalSupply - worker stake), verified exactly on-chain
   * (quorum == quorumBase * numerator / denominator). This is that excluded
   * amount, derived from the authoritative quorum() so it needs no assumption
   * about the registry's internal accounting.
   */
  workerStakeExcludedWei: bigint;
  workerStakeExcludedLcai: number;
  /** The real quorum denominator = pastTotalSupply - workerStakeExcluded. */
  quorumBaseWei: bigint;
  quorumBaseLcai: number;
  /** True when the on-chain quorum matches quorumBase*num/den (stake is excluded). */
  quorumExcludesWorkerStake: boolean;
  /**
   * Contracts holding native LCAI that IS still in the quorum base but cannot be
   * cast (Treasury, FeePool). Worker stake is not here - it's already excluded
   * from the base above.
   */
  nonCastable: NonVotableHolder[];
  nonCastableTotalWei: bigint;
  nonCastableTotalLcai: number;
  /** quorumBase minus the non-castable in-base holdings = actually-castable supply. */
  castableSupplyWei: bigint;
  castableSupplyLcai: number;
  quorumNowWei: bigint;
  quorumNowLcai: number;
  /** Quorum as a % of the actually-castable supply. */
  quorumPctOfCastable: number;
}

export interface WorkerStakeInfo {
  /** All native LCAI held by the WorkerRegistry (stake + unwithdrawn slashed). */
  registryBalanceWei: bigint;
  /** Slashed funds still in the contract (not part of anyone's stake). */
  slashedFundsWei: bigint;
  /** Real total worker stake = registry balance - slashed funds. */
  totalStakedWei: bigint;
  totalStakedLcai: number;
  /** Raw votes the WorkerRegistry address carries (== its balance) - informational. */
  votingPowerWei: bigint;
  /**
   * Always true: staked LCAI is EXCLUDED from the Governor's quorum base, and a
   * worker's own EOA gets zero votes for tokens it has staked (they leave the
   * wallet). Confirmed on-chain via the quorum-base identity in supply().
   */
  nonCastable: boolean;
}

export interface DecentralizationReport {
  timelock: `0x${string}`;
  timelockMinDelaySec: bigint;
  governorIsProposer: boolean;
  executorOpen: boolean;
  /** Timelock administers itself (no external admin key). */
  selfAdministered: boolean;
  treasuryOwner: `0x${string}`;
  treasuryDaoControlled: boolean;
  protocolOwners: { aiConfig: `0x${string}`; workerRegistry: `0x${string}`; jobRegistry: `0x${string}` };
  protocolDaoControlled: boolean;
  /** Single EOA owning all three registries (when they share one non-timelock owner). */
  protocolAdminEoa: `0x${string}` | null;
  verdict: string;
}

/** LightChain native DAO reader. Construct with a network id/config + publicClient. */
export class NativeGovernance {
  readonly network: NetworkConfig;
  private readonly pub: NativeGovClient;

  constructor(network: NetworkId | NetworkConfig, publicClient: NativeGovClient) {
    this.network = typeof network === "string" ? NETWORKS[network] : network;
    if (!this.network) throw new Error(`NativeGovernance: unknown network ${String(network)}`);
    if (!this.network.governor || !this.network.nativeVotes) {
      throw new Error(`NativeGovernance: ${this.network.label} has no governor/nativeVotes configured`);
    }
    this.pub = publicClient;
  }

  private get gov(): `0x${string}` {
    return this.network.governor as `0x${string}`;
  }
  private get votesToken(): `0x${string}` {
    return this.network.nativeVotes as `0x${string}`;
  }

  private read<T>(address: `0x${string}`, abi: readonly unknown[], fn: string, args: readonly unknown[] = []): Promise<T> {
    return this.pub.readContract({ address, abi, functionName: fn, args }) as Promise<T>;
  }

  private balance(address: `0x${string}`): Promise<bigint> {
    if (!this.pub.getBalance) {
      throw new Error("NativeGovernance: publicClient has no getBalance; pass a viem PublicClient for supply/stake reads.");
    }
    return this.pub.getBalance({ address });
  }

  /** Governor voting parameters + live quorum + timelock delay. */
  async config(): Promise<NativeGovConfig> {
    const g = this.gov;
    const [threshold, num, den, delay, period, timelock, clock] = await Promise.all([
      this.read<bigint>(g, GOVERNOR_ABI, "proposalThreshold"),
      this.read<bigint>(g, GOVERNOR_ABI, "quorumNumerator"),
      this.read<bigint>(g, GOVERNOR_ABI, "quorumDenominator"),
      this.read<bigint>(g, GOVERNOR_ABI, "votingDelay"),
      this.read<bigint>(g, GOVERNOR_ABI, "votingPeriod"),
      this.read<`0x${string}`>(g, GOVERNOR_ABI, "timelock"),
      this.read<bigint | number>(g, GOVERNOR_ABI, "clock"),
    ]);
    // quorum() needs a PAST timepoint; clock-1 is the newest valid one.
    // clock() is a uint48 - viem may hand it back as a number, so coerce.
    const clockBig = BigInt(clock);
    const ref = clockBig > 0n ? clockBig - 1n : 0n;
    const [quorumNow, minDelay] = await Promise.all([
      this.read<bigint>(g, GOVERNOR_ABI, "quorum", [ref]),
      this.read<bigint>(timelock, TIMELOCK_ABI, "getMinDelay").catch(() => 0n),
    ]);
    return {
      governor: g,
      timelock,
      token: this.votesToken,
      proposalThresholdWei: threshold,
      proposalThresholdLcai: toLcai(threshold),
      quorumNumerator: num,
      quorumDenominator: den,
      quorumFractionPct: den > 0n ? (Number(num) / Number(den)) * 100 : 0,
      quorumNowWei: quorumNow,
      quorumNowLcai: toLcai(quorumNow),
      votingDelayBlocks: delay,
      votingPeriodBlocks: period,
      timelockMinDelaySec: minDelay,
    };
  }

  /**
   * Voting-supply breakdown. Mechanism verified in the LightChainGovernor source:
   * quorum() is OVERRIDDEN to use `INativeVotes.getTotalVotingPower(t)` (the
   * staked-excluded supply) instead of `IVotes.getPastTotalSupply`. So:
   *   1. `quorumBase` = getTotalVotingPower - the authoritative denominator the
   *      Governor applies the quorum % to. It excludes worker stake:
   *      getPastTotalSupply - getTotalVotingPower == net worker stake (exact),
   *      and a worker's own EOA gets no votes for tokens it has staked.
   *   2. Of what REMAINS in the base, some is still non-castable because it sits
   *      in contracts that can't vote (Treasury, FeePool).
   * (Validator bonded stake is a separate question: it is not reflected in the
   * getPastTotalSupply/getTotalVotingPower delta, which is worker stake only.)
   */
  async supply(): Promise<SupplyBreakdown> {
    const clock = BigInt(await this.read<bigint | number>(this.gov, GOVERNOR_ABI, "clock"));
    const ref = clock > 0n ? clock - 1n : 0n;
    const holders = this.nonCastableHolders();
    const [pastTotal, quorumBase, quorumNow, ...votes] = await Promise.all([
      this.read<bigint>(this.votesToken, VOTES_ABI, "getPastTotalSupply", [ref]),
      // The Governor's quorum() calls this directly (staked-excluded supply).
      this.read<bigint>(this.votesToken, VOTES_ABI, "getTotalVotingPower", [ref]),
      this.read<bigint>(this.gov, GOVERNOR_ABI, "quorum", [ref]),
      ...holders.map((h) => this.read<bigint>(this.votesToken, VOTES_ABI, "getVotes", [h.address])),
    ]);
    const excluded = pastTotal > quorumBase ? pastTotal - quorumBase : 0n;
    const nonCastable: NonVotableHolder[] = holders.map((h, i) => ({
      label: h.label,
      address: h.address,
      votesWei: votes[i],
      lcai: toLcai(votes[i]),
    }));
    const nonCastableTotalWei = nonCastable.reduce((s, h) => s + h.votesWei, 0n);
    const castableWei = quorumBase > nonCastableTotalWei ? quorumBase - nonCastableTotalWei : 0n;
    return {
      pastTotalSupplyWei: pastTotal,
      pastTotalSupplyLcai: toLcai(pastTotal),
      workerStakeExcludedWei: excluded,
      workerStakeExcludedLcai: toLcai(excluded),
      quorumBaseWei: quorumBase,
      quorumBaseLcai: toLcai(quorumBase),
      quorumExcludesWorkerStake: excluded > 0n,
      nonCastable,
      nonCastableTotalWei,
      nonCastableTotalLcai: toLcai(nonCastableTotalWei),
      castableSupplyWei: castableWei,
      castableSupplyLcai: toLcai(castableWei),
      quorumNowWei: quorumNow,
      quorumNowLcai: toLcai(quorumNow),
      quorumPctOfCastable: castableWei > 0n ? (Number(quorumNow) / Number(castableWei)) * 100 : 0,
    };
  }

  /** Contracts whose LCAI is IN the quorum base but non-castable (worker stake is already excluded). */
  private nonCastableHolders(): Array<{ label: string; address: `0x${string}` }> {
    const out: Array<{ label: string; address: `0x${string}` }> = [];
    if (this.network.treasury) out.push({ label: "Treasury", address: this.network.treasury as `0x${string}` });
    if (this.network.feePool) out.push({ label: "FeePool", address: this.network.feePool as `0x${string}` });
    return out;
  }

  /** Total worker stake = WorkerRegistry native balance minus unwithdrawn slashed funds. */
  async workerStake(): Promise<WorkerStakeInfo> {
    const wr = this.network.workerRegistry as `0x${string}`;
    const [balance, slashed, votes] = await Promise.all([
      this.balance(wr),
      this.read<bigint>(wr, WORKER_REGISTRY_ABI, "getSlashedFunds").catch(() => 0n),
      this.read<bigint>(this.votesToken, VOTES_ABI, "getVotes", [wr]),
    ]);
    const staked = balance > slashed ? balance - slashed : balance;
    return {
      registryBalanceWei: balance,
      slashedFundsWei: slashed,
      totalStakedWei: staked,
      totalStakedLcai: toLcai(staked),
      votingPowerWei: votes,
      nonCastable: true,
    };
  }

  /** Who actually controls the treasury and the AI-protocol registries. */
  async decentralization(): Promise<DecentralizationReport> {
    const cfg = await this.config();
    const tl = cfg.timelock;
    const [propRole, execRole, adminRole] = await Promise.all([
      this.read<`0x${string}`>(tl, TIMELOCK_ABI, "PROPOSER_ROLE"),
      this.read<`0x${string}`>(tl, TIMELOCK_ABI, "EXECUTOR_ROLE"),
      this.read<`0x${string}`>(tl, TIMELOCK_ABI, "DEFAULT_ADMIN_ROLE"),
    ]);
    const [govProposer, execOpen, selfAdmin, treasuryOwner, aiOwner, wrOwner, jrOwner] = await Promise.all([
      this.read<boolean>(tl, TIMELOCK_ABI, "hasRole", [propRole, this.gov]),
      this.read<boolean>(tl, TIMELOCK_ABI, "hasRole", [execRole, ZERO]),
      this.read<boolean>(tl, TIMELOCK_ABI, "hasRole", [adminRole, tl]),
      this.read<`0x${string}`>(this.network.treasury as `0x${string}`, OWNABLE_ABI, "owner").catch(() => ZERO),
      this.read<`0x${string}`>(this.network.aiConfig as `0x${string}`, OWNABLE_ABI, "owner").catch(() => ZERO),
      this.read<`0x${string}`>(this.network.workerRegistry as `0x${string}`, OWNABLE_ABI, "owner").catch(() => ZERO),
      this.read<`0x${string}`>(this.network.jobRegistry as `0x${string}`, OWNABLE_ABI, "owner").catch(() => ZERO),
    ]);
    const treasuryDao = sameAddr(treasuryOwner, tl);
    const protocolDao = sameAddr(aiOwner, tl) && sameAddr(wrOwner, tl) && sameAddr(jrOwner, tl);
    const protocolAdminEoa =
      !protocolDao && sameAddr(aiOwner, wrOwner) && sameAddr(wrOwner, jrOwner) ? aiOwner : null;
    return {
      timelock: tl,
      timelockMinDelaySec: cfg.timelockMinDelaySec,
      governorIsProposer: govProposer,
      executorOpen: execOpen,
      selfAdministered: selfAdmin,
      treasuryOwner,
      treasuryDaoControlled: treasuryDao,
      protocolOwners: { aiConfig: aiOwner, workerRegistry: wrOwner, jobRegistry: jrOwner },
      protocolDaoControlled: protocolDao,
      protocolAdminEoa,
      verdict: buildVerdict({ treasuryDao, protocolDao, protocolAdminEoa, govProposer, selfAdmin }),
    };
  }

  /** One-call bundle: config + supply + workerStake + decentralization. */
  async report(): Promise<{
    config: NativeGovConfig;
    supply: SupplyBreakdown;
    workerStake: WorkerStakeInfo;
    decentralization: DecentralizationReport;
  }> {
    const [config, supply, workerStake, decentralization] = await Promise.all([
      this.config(),
      this.supply(),
      this.workerStake(),
      this.decentralization(),
    ]);
    return { config, supply, workerStake, decentralization };
  }
}

function buildVerdict(x: {
  treasuryDao: boolean;
  protocolDao: boolean;
  protocolAdminEoa: `0x${string}` | null;
  govProposer: boolean;
  selfAdmin: boolean;
}): string {
  const govLine =
    x.treasuryDao && x.govProposer && x.selfAdmin
      ? "Governance + Treasury: DECENTRALIZED (Timelock-owned treasury, Governor is sole proposer, timelock self-administered)."
      : "Governance + Treasury: PARTIAL (check treasury owner / timelock roles below).";
  const protoLine = x.protocolDao
    ? "AI protocol: DAO-controlled (registries owned by the Timelock)."
    : `AI protocol: CENTRALIZED - AIConfig/WorkerRegistry/JobRegistry are ${
        x.protocolAdminEoa ? `owned by EOA ${x.protocolAdminEoa}` : "owned by non-Timelock accounts"
      }, which can change stake, slashing, fees and models unilaterally.`;
  return `${govLine} ${protoLine}`;
}
