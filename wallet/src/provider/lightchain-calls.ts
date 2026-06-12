/**
 * Positive identification of LightChain ecosystem contract calls so the native
 * wallet does not flag its OWN protocol as an "unrecognized contract call".
 *
 * decode-call.ts answers "could this drain me?" from calldata alone. This
 * answers "is this a known LightChain action?" and needs the destination
 * address too: a friendly label is only shown when `to` is the canonical
 * protocol contract for that chain, never for a lookalike that merely copies a
 * selector. Recognized calls render as a reassuring protocol banner instead of
 * the generic "only approve if you trust this site" warning.
 *
 * Pure + unit-tested (no DOM, no network).
 */
import { decodeFunctionData, formatEther, parseAbi, type Hex } from "viem";

export interface RecognizedCall {
  /** The protocol contract, e.g. "LightChain JobRegistry". */
  contract: string;
  /** The action in plain language, e.g. "Submit an AI prompt". */
  action: string;
  /** One-line explanation shown under the action. */
  detail: string;
}

const SYMBOL_BY_CHAIN: Record<number, string> = { 9200: "LCAI", 8200: "LCAI", 1: "ETH" };
const sym = (chainId: number): string => SYMBOL_BY_CHAIN[chainId] ?? "the native coin";

const JOB_REGISTRY_ABI = parseAbi([
  "function createSession(bytes32 paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey, bytes initState, uint256 expiry) payable returns (uint256)",
  "function submitJob(uint256 sessionId, bytes32 promptHash) payable returns (uint256)",
  "function withdraw()",
]);
const WORKER_REGISTRY_ABI = parseAbi([
  "function registerWorker(bytes encryptionPubKey) payable",
  "function deregisterWorker()",
]);
const GOVERNOR_ABI = parseAbi(["function castVote(uint256 proposalId, uint8 support) returns (uint256)"]);
const BRIDGE_ABI = parseAbi(["function transferRemote(uint32 destination, bytes32 recipient, uint256 amount) payable returns (bytes32)"]);

type Labeler = (fn: string, args: readonly unknown[], valueWei: bigint, chainId: number) => Omit<RecognizedCall, "contract"> | null;

interface ContractDef {
  name: string;
  abi: readonly unknown[];
  label: Labeler;
}

const VOTE_LABEL: Record<number, string> = { 0: "Against", 1: "For", 2: "Abstain" };

const jobRegistry: ContractDef = {
  name: "LightChain JobRegistry",
  abi: JOB_REGISTRY_ABI,
  label: (fn, args, valueWei, chainId) => {
    if (fn === "createSession") {
      // createSession is payable: an attacker can attach msg.value, so never
      // claim "no tokens move" unless the value really is zero.
      const detail =
        valueWei > 0n
          ? `Opens an inference session and sends ${formatEther(valueWei)} ${sym(chainId)} with it.`
          : "Opens a private inference session with a worker. No tokens move now - you pay per prompt.";
      return { action: "Start an encrypted AI session", detail };
    }
    if (fn === "submitJob")
      // The value is dapp-supplied; we cannot assert it equals the protocol fee.
      return { action: "Submit an AI prompt", detail: `Runs one encrypted inference. Native value sent: ${formatEther(valueWei)} ${sym(chainId)}.` };
    if (fn === "withdraw")
      return { action: "Withdraw worker earnings", detail: "Pulls your claimable worker balance to this wallet." };
    return null;
  },
};

const workerRegistry: ContractDef = {
  name: "LightChain WorkerRegistry",
  abi: WORKER_REGISTRY_ABI,
  label: (fn, _args, valueWei, chainId) => {
    if (fn === "registerWorker")
      // The value is dapp-supplied; we cannot assert it equals the required stake.
      return { action: "Register as a worker", detail: `Registers this address as a LightChain AI worker. Native value sent as stake: ${formatEther(valueWei)} ${sym(chainId)}.` };
    if (fn === "deregisterWorker")
      return { action: "Deregister your worker", detail: "Removes this address from the worker set so you can withdraw your stake." };
    return null;
  },
};

const governor: ContractDef = {
  name: "LightChain Governor",
  abi: GOVERNOR_ABI,
  label: (fn, args) => {
    if (fn !== "castVote") return null;
    const support = Number(args[1]);
    const choice = VOTE_LABEL[support] ?? `option ${support}`;
    return { action: "Cast a DAO vote", detail: `Votes ${choice} on proposal #${String(args[0])}.` };
  },
};

const bridge: ContractDef = {
  name: "LCAI Bridge",
  abi: BRIDGE_ABI,
  label: (fn, args, _valueWei, chainId) => {
    if (fn !== "transferRemote") return null;
    return { action: "Bridge LCAI", detail: `Moves ${formatEther(BigInt(args[2] as bigint))} LCAI across the Ethereum <-> LightChain bridge.` };
  },
};

// (chainId -> lowercased address -> contract). Addresses are the canonical
// protocol deployments; recognition is gated on an exact match so a lookalike
// contract can never borrow a trusted label.
const REGISTRY: Record<number, Record<string, ContractDef>> = {
  9200: {
    "0xfb15f90298e4ccd7106e76ffb5e520315cc42b0b": jobRegistry,
    "0x0000000000000000000000000000000000001002": workerRegistry,
    "0x262e9f9232933e8565253918db703bad58de93ab": governor,
    "0xec7096a3116ee769457c939617375ec1785aa6f1": bridge,
  },
  1: {
    "0x6dfa413b5900a1a7947bc75e68abba093cb2492d": governor,
    "0x01f80bb8e78e79881e8ec7832fb6c2c59f64e353": bridge,
  },
};

/**
 * Identify a known LightChain protocol call, or null when the destination is
 * not a canonical protocol contract on this chain (or the selector is not one
 * we vouch for). `valueWei` enriches fee/stake wording; defaults to 0.
 */
export function recognizeLightChainCall(
  to: string | undefined | null,
  data: Hex | undefined | null,
  chainId: number | undefined,
  valueWei: bigint = 0n,
): RecognizedCall | null {
  if (!to || chainId === undefined) return null;
  const def = REGISTRY[chainId]?.[to.toLowerCase()];
  if (!def) return null;
  // A bare value transfer to a protocol contract is not a recognized CALL.
  if (!data || data === "0x" || data.length < 10) return null;
  try {
    const { functionName, args } = decodeFunctionData({ abi: def.abi, data });
    const labelled = def.label(functionName, (args ?? []) as readonly unknown[], valueWei, chainId);
    return labelled ? { contract: def.name, ...labelled } : null;
  } catch {
    return null; // selector not in this contract's vouched-for set
  }
}
