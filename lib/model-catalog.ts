/**
 * Canonical model catalog + on-chain id recovery.
 *
 * WHY THIS EXISTS
 * ---------------
 * A model's on-chain identity is `id = keccak256(tag)` (see sdk/src/inference.ts).
 * The registry stores only that digest - it carries no name, no size, and no
 * quantization. When a model is whitelisted without its tag string, the indexer
 * has nothing to put in `name`, so it echoes the id back: `name === id`. The UI
 * then renders a raw 66-char hash, and `modelRequirement()` - which infers size
 * by regex over the *name* - silently falls back to "8GB / Standard" for it.
 *
 * keccak256 is one-way, so a hash cannot be decoded back to a tag. What we CAN
 * do is invert a *known* set: hash every tag we know and match. That is a
 * dictionary lookup, not decoding - it recovers today's registrations and will
 * not recover a future model whose tag we've never seen. Hence `known: false`
 * stays a first-class state everywhere downstream; we never guess.
 *
 * SIZES
 * -----
 * The registry exposes no size field, and the tag string alone cannot size a
 * model (nothing in "glm-4.7-flash" or "qwen3-coder-next" implies a parameter
 * count, and MoE models decouple params from footprint entirely). So sizes here
 * are measured, with provenance recorded per entry:
 *   - `downloadGb`  summed manifest layer bytes from registry.ollama.ai
 *   - `peakVramGb`  observed resident peak during inference, where we have it
 * Fit decisions use `peakVramGb` when measured, else a conservative estimate
 * from `downloadGb` (weights + KV cache/context/runtime overhead).
 */
import { keccak256, toBytes } from "viem";

export interface CatalogEntry {
  /** Exact tag as registered on chain - keccak256 of this is the model id. */
  tag: string;
  /** Summed Ollama manifest layer bytes (the download). */
  downloadGb: number;
  /** Measured peak resident VRAM during inference, when we have a real number. */
  peakVramGb?: number;
  /** True for embedding models (max_output_tokens is 1, not a chat model). */
  embedding?: boolean;
  /** Human note shown in the UI when useful. */
  note?: string;
}

/**
 * Known tags. Sizes are measured, not inferred.
 *
 * `downloadGb` = registry.ollama.ai manifest layer sum.
 * `peakVramGb` = resident VRAM reported by Ollama's /api/ps with the model
 * loaded and answering (size_vram), i.e. what actually occupies the card.
 *
 * DOWNLOAD SIZE IS NOT RESIDENT SIZE. Treating it as one is badly wrong for
 * mixture-of-experts models, where only the active experts stay on the GPU:
 * gemma4:e2b is a 7.2 GB download that sits at 1.7 GB resident - a 4x
 * over-estimate if you scale the download. That is why `residentVramGb()`
 * only falls back to a download-derived estimate when we have no measurement,
 * and why adding a measurement is always preferable to trusting the fallback.
 *
 * Measured on an RTX 5060 Ti 16GB (Blackwell, driver 610.43.02, CUDA 13,
 * Ollama 0.32.5). Figures are the model's own resident bytes; each loaded
 * model additionally costs a few hundred MB of CUDA context, so a set's real
 * GPU usage runs above the sum of these numbers - budget headroom accordingly.
 */
export const MODEL_CATALOG: CatalogEntry[] = [
  { tag: "qwen3-embedding:0.6b", downloadGb: 0.6, peakVramGb: 2.3, embedding: true, note: "Embedding model - returns vectors, not chat text" },
  { tag: "llama3-8b", downloadGb: 4.7 },
  { tag: "qwen3-vl:8b", downloadGb: 6.1, peakVramGb: 5.7, note: "Vision" },
  { tag: "gemma4:e2b", downloadGb: 7.2, peakVramGb: 1.7, note: "MoE - only the active experts stay resident, so it costs far less VRAM than its download suggests" },
  { tag: "gpt-oss:20b", downloadGb: 13.8, peakVramGb: 12.7, note: "Reasoning - MXFP4" },
  { tag: "glm-4.7-flash", downloadGb: 19.0, peakVramGb: 17.8, note: "Coding" },
  { tag: "qwen3-vl:30b", downloadGb: 19.6, peakVramGb: 17.9, note: "Vision" },
  { tag: "llama3-70b", downloadGb: 40.0 },
  { tag: "qwen3-coder-next", downloadGb: 51.7, note: "Coding - large context (16k output)" },
  { tag: "gpt-oss:120b", downloadGb: 65.4, peakVramGb: 59.9, note: "Reasoning - MXFP4, server-class" },
];

/** modelId (lowercase 0x hash) -> catalog entry. Built once, from the tags. */
export const ENTRY_BY_ID: ReadonlyMap<string, CatalogEntry> = new Map(
  MODEL_CATALOG.map((e) => [keccak256(toBytes(e.tag)).toLowerCase(), e]),
);

/** tag -> catalog entry. */
export const ENTRY_BY_TAG: ReadonlyMap<string, CatalogEntry> = new Map(
  MODEL_CATALOG.map((e) => [e.tag.toLowerCase(), e]),
);

/** The on-chain id for a tag: keccak256(utf8 bytes of the exact tag). */
export function modelIdForTag(tag: string): string {
  return keccak256(toBytes(tag)).toLowerCase();
}

/** A 32-byte hex digest, i.e. what the registry uses as a model id. */
export function isModelId(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s.trim());
}

/**
 * Resolve whatever the indexer gave us into a display name + identity.
 *
 * `name` from the subgraph is either a real tag or (when the registration
 * carried none) the id echoed back. We only ever treat the result as a servable
 * tag when `known` is true - an unrecovered id is NOT a tag and must never be
 * passed to `ollama pull` or hashed again into a second, bogus id.
 */
export interface ResolvedModel {
  /** Safe to show. Either the real tag or a short, readable placeholder. */
  label: string;
  /** The real Ollama/registry tag, or null when we could not recover it. */
  tag: string | null;
  /** True when `tag` is a real tag we can serve. */
  known: boolean;
  /** The on-chain model id, when we have it. */
  id?: string;
  entry?: CatalogEntry;
}

export function resolveModel(name: string, id?: string): ResolvedModel {
  const rawId = (id ?? "").trim().toLowerCase();
  const trimmed = (name ?? "").trim();
  // The id is the identity, and because id = keccak256(tag) we can PROVE
  // whether a claimed name is the real preimage rather than trusting it. That
  // proof is what makes this function idempotent, which it has to be: the
  // subgraph resolves once and stores the result, then the picker resolves the
  // stored value again. Without the check, the placeholder produced by the
  // first pass ("unnamed 0x1234abcd…") is not a digest, so a shape-only test
  // would wave it through as a real tag on the second pass and hand back
  // `{ tag: "unnamed 0x1234abcd…", known: true }` - a placeholder marked
  // servable, which is exactly the failure this module exists to prevent.
  const lookupId = isModelId(rawId) ? rawId : isModelId(trimmed) ? trimmed.toLowerCase() : "";

  if (lookupId) {
    // A name that hashes to this id is the genuine tag - including for models
    // we have never seen, so a correctly-registered future model still works.
    if (trimmed && !isModelId(trimmed) && modelIdForTag(trimmed) === lookupId) {
      return { label: trimmed, tag: trimmed, known: true, id: lookupId, entry: ENTRY_BY_TAG.get(trimmed.toLowerCase()) };
    }
    // Otherwise `name` proves nothing (it is the echoed id, one of our own
    // placeholders, or junk). Fall back to inverting the id against the catalog.
    const entry = ENTRY_BY_ID.get(lookupId);
    if (entry) return { label: entry.tag, tag: entry.tag, known: true, id: lookupId, entry };
    return { label: `unnamed ${lookupId.slice(0, 10)}…`, tag: null, known: false, id: lookupId };
  }

  // No usable id to check against - trust the indexer's name, but never a bare
  // digest, which is an echoed id with the id column missing.
  if (trimmed && !isModelId(trimmed)) {
    return { label: trimmed, tag: trimmed, known: true, id: undefined, entry: ENTRY_BY_TAG.get(trimmed.toLowerCase()) };
  }
  return { label: "unnamed model", tag: null, known: false, id: rawId || undefined };
}

/**
 * Resident VRAM (GB) needed to keep a model warm.
 *
 * Prefers a measured peak. Otherwise estimates from the download: weights plus
 * KV cache, context and runtime overhead. Rounded to one decimal so the UI does
 * not imply precision we do not have.
 */
export function residentVramGb(entry: CatalogEntry): number {
  if (entry.peakVramGb != null) return entry.peakVramGb;
  return Math.round((entry.downloadGb * 1.15 + 0.7) * 10) / 10;
}

/** Catalog lookup by tag or id, whichever the caller has. */
export function lookupModel(tagOrId: string): CatalogEntry | undefined {
  const k = tagOrId.trim().toLowerCase();
  return isModelId(k) ? ENTRY_BY_ID.get(k) : ENTRY_BY_TAG.get(k);
}
