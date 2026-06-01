/**
 * DAO SDK: typed wrapper around the LCAI Governor (OpenZeppelin Governor v5)
 * on Ethereum mainnet. Addresses extracted from
 * `lightchain-protocol/LCAI-dao-frontend/config/index.ts`.
 *
 * Governance is currently Ethereum-side (chain 1). Voting on LCAI proposals
 * happens via the LCAI ERC-20 wrapped as IVotes (LCAIBallots). Execution
 * goes through LCAITimeLock with the timelock controller managing actual
 * calldata dispatch.
 *
 * Voting parameters (hard-coded in LCAIGovernor.sol constructor):
 *   - votingDelay      = 7,200 blocks   (~1 day at 12s)
 *   - votingPeriod     = 100,800 blocks (~14 days at 12s)
 *   - proposalThreshold = 140,000 LCAI  (votes required to create a proposal)
 *   - quorum            = 3% of total supply (3-15 by admin)
 *
 * This module covers the OZ Governor v5 surface: state machine, propose,
 * castVote, queue, execute. Plus convenience reads of the constants.
 */

import { keccak256, parseAbi, toBytes } from "viem";

/**
 * Both deployed DAOs we know about:
 *
 *   - `ethereum`         LCAIGovernor on Ethereum mainnet. Token holders
 *                        wrap LCAI ERC-20 into LCAI-Ballots (IVotes) at
 *                        https://ballots.lightchain.ai, then vote /
 *                        propose / queue / execute through the Governor.
 *                        Proposal threshold: 140,000 LCAI wrapped.
 *
 *   - `lightchain`       LightChainGovernor on LightChain mainnet (chain
 *                        9200). Uses the NativeVotes precompile at
 *                        0x...0001001 - native LCAI itself acts as the
 *                        voting token, no wrapping needed. Governor is
 *                        an upgradeable proxy controlled by the
 *                        TimelockController.
 *
 * Addresses sourced from LightChain's official "Mainnet Contract Addresses"
 * page.
 */
export type DaoChain = "ethereum" | "lightchain";

export interface DaoAddresses {
  chainId: number;
  label: string;
  /** OZ Governor contract (proxy when behind an upgradeable pattern). */
  governor: `0x${string}`;
  /** Timelock controller. queue/execute dispatch through this. */
  timelock: `0x${string}`;
  /** ERC-20 wrapped as IVotes (null when the chain uses a NativeVotes precompile). */
  ballots: `0x${string}` | null;
  /** Underlying governance token (LCAI ERC-20 on Ethereum, native LCAI on LightChain). */
  token: `0x${string}` | null;
  /** Treasury contract holding DAO funds. */
  treasury: `0x${string}`;
  /** Optional UI link (where regular users wrap / view proposals). */
  wrapperUi?: string;
  explorer: string;
}

/**
 * Confirmed deployment addresses. Each entry is what an SDK user passes to
 * `new DAO(client, chainKey, walletClient?)`.
 */
export const DAO_ADDRESSES: Record<DaoChain, DaoAddresses> = {
  ethereum: {
    chainId: 1,
    label: "Ethereum mainnet",
    governor: "0x6dfa413B5900a1a7947BC75E68AbBA093cB2492d",
    timelock: "0xbE1c37F8C4DA77dD06F4A8AC5098Ec70273093d7",
    ballots: "0x75F3D01c4D960FE986A598B7954A3b786B29cE49",
    token: "0x9cA8530CA349c966Fe9ef903Df17a75B8A778927",
    treasury: "0x07A716a551E5f4CA7D6C71Da9dF1cb1429Dba826",
    wrapperUi: "https://ballots.lightchain.ai",
    explorer: "https://etherscan.io",
  },
  lightchain: {
    chainId: 9200,
    label: "LightChain mainnet",
    governor: "0x262E9f9232933E8565253918db703baD58DE93aB",
    timelock: "0x79e571420c5473Ca9b0FCd599B1b0062D7793c97",
    // Native voting via the genesis predeploy precompile; no separate wrapping token.
    ballots: "0x0000000000000000000000000000000000001001",
    token: null,
    treasury: "0x786eDe8C42Ca54E54c9dCECa9b30052CF4743389",
    explorer: "https://mainnet.lightscan.app",
  },
};

/**
 * The 8-state OZ Governor v5 enum. The string label is what most builders
 * will want to surface in a UI.
 */
export enum ProposalState {
  Pending = 0,
  Active = 1,
  Canceled = 2,
  Defeated = 3,
  Succeeded = 4,
  Queued = 5,
  Expired = 6,
  Executed = 7,
}

export const PROPOSAL_STATE_LABEL: Record<ProposalState, string> = {
  [ProposalState.Pending]: "pending",
  [ProposalState.Active]: "active",
  [ProposalState.Canceled]: "canceled",
  [ProposalState.Defeated]: "defeated",
  [ProposalState.Succeeded]: "succeeded",
  [ProposalState.Queued]: "queued",
  [ProposalState.Expired]: "expired",
  [ProposalState.Executed]: "executed",
};

/** Vote support values. Maps to OZ's GovernorCountingSimple. */
export enum VoteSupport {
  Against = 0,
  For = 1,
  Abstain = 2,
}

/** OZ Governor v5 ABI (subset). */
export const GOVERNOR_ABI = parseAbi([
  "function propose(address[] targets, uint256[] values, bytes[] calldatas, string description) external returns (uint256 proposalId)",
  "function castVote(uint256 proposalId, uint8 support) external returns (uint256)",
  "function castVoteWithReason(uint256 proposalId, uint8 support, string reason) external returns (uint256)",
  "function queue(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) external returns (uint256)",
  "function execute(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) external payable returns (uint256)",
  "function state(uint256 proposalId) external view returns (uint8)",
  "function hashProposal(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) external pure returns (uint256)",
  "function votingDelay() external view returns (uint256)",
  "function votingPeriod() external view returns (uint256)",
  "function proposalThreshold() external view returns (uint256)",
  "function quorum(uint256 timepoint) external view returns (uint256)",
  "function proposalVotes(uint256 proposalId) external view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)",
  "function proposalSnapshot(uint256 proposalId) external view returns (uint256)",
  "function proposalDeadline(uint256 proposalId) external view returns (uint256)",
  "function proposalProposer(uint256 proposalId) external view returns (address)",
  "function proposalEta(uint256 proposalId) external view returns (uint256)",
  "function getVotes(address account, uint256 timepoint) external view returns (uint256)",
  "function hasVoted(uint256 proposalId, address account) external view returns (bool)",
  "function cancel(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) external returns (uint256)",
  // Events - needed for recentProposals() event scan.
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
]);

/** Minimal IVotes ABI for delegate + balance reads (LCAIBallots). */
export const VOTES_ABI = parseAbi([
  "function balanceOf(address) external view returns (uint256)",
  "function getVotes(address) external view returns (uint256)",
  "function delegates(address) external view returns (address)",
  "function delegate(address delegatee) external returns (bool)",
]);

interface MinimalPublicClient {
  readContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }) => Promise<unknown>;
  // Optional event-scan surface used by `recentProposals`. Made optional so
  // older callers that only need reads keep type-checking.
  getBlockNumber?: () => Promise<bigint>;
  getLogs?: (args: {
    address?: `0x${string}`;
    event?: unknown;
    args?: Record<string, unknown>;
    fromBlock?: bigint | "earliest" | "latest";
    toBlock?: bigint | "latest";
  }) => Promise<ReadonlyArray<{ args?: Record<string, unknown>; blockNumber?: bigint; transactionHash?: `0x${string}` }>>;
}

interface MinimalWalletClient {
  writeContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
    gas?: bigint;
  }) => Promise<`0x${string}`>;
}

export interface ProposalSummary {
  id: bigint;
  state: ProposalState;
  stateLabel: string;
  proposer: `0x${string}` | null;
  snapshot: bigint; // block where the vote token weights are snapshotted
  deadline: bigint; // block voting ends
  eta: bigint; // unix seconds when timelock allows execution (0 until queued)
  votes: {
    againstWei: bigint;
    forWei: bigint;
    abstainWei: bigint;
  };
}

export interface DaoConfig {
  votingDelayBlocks: bigint;
  votingPeriodBlocks: bigint;
  proposalThresholdWei: bigint;
  /** Approx voting period in seconds, assuming 12s/block on Ethereum. */
  votingPeriodSecs: number;
}

/**
 * One row returned by `DAO.recentProposals`. Lightweight summary you can
 * map straight into a list UI. Use `dao.proposal(id)` for the full vote
 * counts and exact deadlines.
 */
export interface ProposalRow {
  id: bigint;
  proposer: `0x${string}`;
  /** First non-empty line of the proposal `description`. */
  title: string;
  state: ProposalState;
  stateLabel: string;
  blockNumber: bigint;
}

/**
 * DAO client. Wraps reads (proposal state, config) + writes (propose, vote,
 * queue, execute) on the Ethereum LCAIGovernor.
 */
export class DAO {
  /** Addresses for the configured DAO chain. Currently only Ethereum mainnet. */
  readonly addresses: DaoAddresses;

  constructor(
    private readonly publicClient: MinimalPublicClient,
    chain: DaoChain = "ethereum",
    private readonly walletClient?: MinimalWalletClient,
  ) {
    this.addresses = DAO_ADDRESSES[chain];
  }

  // -------- Reads --------

  /** Current proposal state by id. */
  async state(proposalId: bigint): Promise<ProposalState> {
    const raw = (await this.publicClient.readContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "state",
      args: [proposalId],
    })) as number;
    return raw as ProposalState;
  }

  /** Full proposal summary by id. Aggregates state + votes + key blocks. */
  async proposal(proposalId: bigint): Promise<ProposalSummary> {
    const [stateRaw, votesRaw, snapshot, deadline, eta, proposerRaw] = (await Promise.all([
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "state", args: [proposalId] }),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "proposalVotes", args: [proposalId] }),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "proposalSnapshot", args: [proposalId] }),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "proposalDeadline", args: [proposalId] }),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "proposalEta", args: [proposalId] }).catch(() => 0n),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "proposalProposer", args: [proposalId] }).catch(() => null),
    ])) as [number, [bigint, bigint, bigint], bigint, bigint, bigint, `0x${string}` | null];
    const state = stateRaw as ProposalState;
    return {
      id: proposalId,
      state,
      stateLabel: PROPOSAL_STATE_LABEL[state] ?? "unknown",
      proposer: proposerRaw,
      snapshot,
      deadline,
      eta,
      votes: { againstWei: votesRaw[0], forWei: votesRaw[1], abstainWei: votesRaw[2] },
    };
  }

  /** Whether `voter` has cast a vote on `proposalId`. */
  hasVoted(proposalId: bigint, voter: `0x${string}`): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "hasVoted",
      args: [proposalId, voter],
    }) as Promise<boolean>;
  }

  /** Voting weight of `voter` at a specific block (use the proposal's `snapshot`). */
  getVotes(voter: `0x${string}`, timepoint: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "getVotes",
      args: [voter, timepoint],
    }) as Promise<bigint>;
  }

  /** Aggregated voting parameters of the LCAIGovernor. */
  async config(): Promise<DaoConfig> {
    const [delay, period, threshold] = (await Promise.all([
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "votingDelay" }),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "votingPeriod" }),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "proposalThreshold" }),
    ])) as [bigint, bigint, bigint];
    return {
      votingDelayBlocks: delay,
      votingPeriodBlocks: period,
      proposalThresholdWei: threshold,
      votingPeriodSecs: Number(period) * 12,
    };
  }

  /** Quorum required at a given timepoint (in wei of voting weight). */
  quorum(timepoint: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "quorum",
      args: [timepoint],
    }) as Promise<bigint>;
  }

  /**
   * List recent proposals on the governor by scanning `ProposalCreated`
   * events. Scans back `lookbackBlocks` from the current head and returns
   * up to `limit` proposals (newest first) with their current state.
   *
   * Ethereum mainnet RPCs cap a single `getLogs` to 10k blocks; the SDK
   * chunks the range automatically. Default lookback is 300k blocks
   * (~40 days) and default limit is 10.
   */
  async recentProposals(opts: { lookbackBlocks?: number; limit?: number } = {}): Promise<ProposalRow[]> {
    if (!this.publicClient.getLogs || !this.publicClient.getBlockNumber) {
      throw new Error(
        "DAO.recentProposals: publicClient does not expose getLogs / getBlockNumber. Use a viem PublicClient.",
      );
    }
    const lookback = BigInt(opts.lookbackBlocks ?? 300_000);
    const limit = Math.max(1, opts.limit ?? 10);
    const head = await this.publicClient.getBlockNumber();
    const start = head > lookback ? head - lookback : 0n;
    const CHUNK = 10_000n;
    // ProposalCreated is item index that matches the parsed ABI entry.
    const event = (GOVERNOR_ABI as readonly { type?: string; name?: string }[]).find(
      (x) => x.type === "event" && x.name === "ProposalCreated",
    );
    if (!event) throw new Error("DAO.recentProposals: ProposalCreated event missing from GOVERNOR_ABI");

    // Fan out chunked log reads in parallel - same shape the public proxy
    // endpoint uses, but driven entirely by the caller's RPC.
    const ranges: Array<{ from: bigint; to: bigint }> = [];
    for (let from = start; from <= head; from += CHUNK) {
      const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
      ranges.push({ from, to });
    }
    const rows: ProposalRow[] = [];
    const settled = await Promise.allSettled(
      ranges.map((r) =>
        this.publicClient.getLogs!({
          address: this.addresses.governor,
          event,
          fromBlock: r.from,
          toBlock: r.to,
        }),
      ),
    );
    for (const res of settled) {
      if (res.status !== "fulfilled") continue;
      for (const log of res.value) {
        const args = log.args ?? {};
        const id = args.proposalId as bigint | undefined;
        const proposer = args.proposer as `0x${string}` | undefined;
        const description = (args.description as string | undefined) ?? "";
        if (id == null || !proposer) continue;
        const title = description.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? `Proposal #${id.toString()}`;
        rows.push({
          id,
          proposer,
          title: title.length > 140 ? title.slice(0, 137) + "..." : title,
          // state filled in below in one batched call
          state: 0 as ProposalState,
          stateLabel: "",
          blockNumber: log.blockNumber ?? 0n,
        });
      }
    }
    // Sort newest-first by id (uint256 monotonic in OZ Governor) and trim.
    rows.sort((a, b) => (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
    const trimmed = rows.slice(0, limit);
    // Fetch the live state for each in parallel so the row is immediately usable.
    const states = await Promise.all(trimmed.map((r) => this.state(r.id).catch(() => 0 as ProposalState)));
    return trimmed.map((r, i) => ({
      ...r,
      state: states[i],
      stateLabel: PROPOSAL_STATE_LABEL[states[i]] ?? "unknown",
    }));
  }

  // -------- Writes --------

  /** Cast a For / Against / Abstain vote. Wallet must be the voter and have delegated their LCAI. */
  castVote(proposalId: bigint, support: VoteSupport, reason?: string): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("DAO: no wallet client; pass one to the DAO constructor for writes");
    return reason
      ? this.walletClient.writeContract({
          address: this.addresses.governor,
          abi: GOVERNOR_ABI,
          functionName: "castVoteWithReason",
          args: [proposalId, support, reason],
        })
      : this.walletClient.writeContract({
          address: this.addresses.governor,
          abi: GOVERNOR_ABI,
          functionName: "castVote",
          args: [proposalId, support],
        });
  }

  /** Submit a new proposal. Wallet must hold at least `proposalThreshold` delegated votes. */
  propose(args: {
    targets: `0x${string}`[];
    values: bigint[];
    calldatas: `0x${string}`[];
    description: string;
  }): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("DAO: no wallet client; pass one to the DAO constructor for writes");
    return this.walletClient.writeContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "propose",
      args: [args.targets, args.values, args.calldatas, args.description],
    });
  }

  /** Queue a Succeeded proposal into the timelock. */
  queue(args: {
    targets: `0x${string}`[];
    values: bigint[];
    calldatas: `0x${string}`[];
    descriptionHash: `0x${string}`;
  }): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("DAO: no wallet client; pass one to the DAO constructor for writes");
    return this.walletClient.writeContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "queue",
      args: [args.targets, args.values, args.calldatas, args.descriptionHash],
    });
  }

  /**
   * Execute a Queued proposal. The Governor enforces
   * `msg.value == sum(values)`; pass the sum as `value`.
   */
  execute(args: {
    targets: `0x${string}`[];
    values: bigint[];
    calldatas: `0x${string}`[];
    descriptionHash: `0x${string}`;
  }): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("DAO: no wallet client; pass one to the DAO constructor for writes");
    const totalValue = args.values.reduce((acc, v) => acc + v, 0n);
    return this.walletClient.writeContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "execute",
      args: [args.targets, args.values, args.calldatas, args.descriptionHash],
      value: totalValue,
    });
  }

  /**
   * Cancel a proposal. OZ Governor permits the proposer (and sometimes the
   * Guardian / Timelock role) to cancel a Pending or Active proposal. Same
   * `descriptionHash` you'd pass to `queue` / `execute`.
   */
  cancel(args: {
    targets: `0x${string}`[];
    values: bigint[];
    calldatas: `0x${string}`[];
    descriptionHash: `0x${string}`;
  }): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("DAO: no wallet client; pass one to the DAO constructor for writes");
    return this.walletClient.writeContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "cancel",
      args: [args.targets, args.values, args.calldatas, args.descriptionHash],
    });
  }

  // -------- Helpers (pure, no chain reads) --------

  /**
   * keccak256 of the raw description string. The Governor stores proposals
   * keyed by `(targets, values, calldatas, descriptionHash)` rather than
   * the description itself - this is the same hash the OZ Governor computes
   * internally. Pass it to `queue`, `execute`, `cancel`, `hashProposal`.
   */
  descriptionHash(description: string): `0x${string}` {
    return keccak256(toBytes(description));
  }

  /**
   * Predict a proposal id BEFORE submitting. Mirrors `Governor.hashProposal`
   * on chain so you can compute the id deterministically (the proposer can
   * persist it ahead of time, drop it into a UI, or sanity-check that a
   * proposal hasn't already been submitted).
   */
  async hashProposal(args: {
    targets: `0x${string}`[];
    values: bigint[];
    calldatas: `0x${string}`[];
    /** Either the description string or the precomputed hash; both accepted. */
    description: string | `0x${string}`;
  }): Promise<bigint> {
    const descHash: `0x${string}` =
      typeof args.description === "string" && args.description.startsWith("0x") && args.description.length === 66
        ? (args.description as `0x${string}`)
        : keccak256(toBytes(args.description));
    return this.publicClient.readContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "hashProposal",
      args: [args.targets, args.values, args.calldatas, descHash],
    }) as Promise<bigint>;
  }

  // -------- IVotes helpers (LCAIBallots wrapped token) --------

  /**
   * IVotes.balanceOf - wrapped voting-token balance (LCAIBallots on Ethereum
   * mainnet, native LCAI via the NativeVotes precompile on LightChain
   * mainnet). Returns wei.
   */
  getBallotsBalance(voter: `0x${string}`): Promise<bigint> {
    const ballots = this.addresses.ballots;
    if (!ballots) throw new Error("DAO.getBallotsBalance: this chain has no Ballots address");
    return this.publicClient.readContract({
      address: ballots,
      abi: VOTES_ABI,
      functionName: "balanceOf",
      args: [voter],
    }) as Promise<bigint>;
  }

  /**
   * Address the voter has delegated to. Wraps `IVotes.delegates`. The zero
   * address means the voter has not yet delegated, which is the OZ default
   * (no voting power for self until you self-delegate).
   */
  getDelegate(voter: `0x${string}`): Promise<`0x${string}`> {
    const ballots = this.addresses.ballots;
    if (!ballots) throw new Error("DAO.getDelegate: this chain has no Ballots address");
    return this.publicClient.readContract({
      address: ballots,
      abi: VOTES_ABI,
      functionName: "delegates",
      args: [voter],
    }) as Promise<`0x${string}`>;
  }

  /**
   * Delegate voting weight to `delegatee` (use the voter's own address to
   * self-delegate, which is the common first step before voting). Wallet
   * required.
   */
  delegate(delegatee: `0x${string}`): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("DAO: no wallet client; pass one to the DAO constructor for writes");
    const ballots = this.addresses.ballots;
    if (!ballots) throw new Error("DAO.delegate: this chain has no Ballots address");
    return this.walletClient.writeContract({
      address: ballots,
      abi: VOTES_ABI,
      functionName: "delegate",
      args: [delegatee],
    });
  }
}
