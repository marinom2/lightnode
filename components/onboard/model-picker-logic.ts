/**
 * The parts of the model picker that are decisions, not markup.
 *
 * They live outside the .tsx because they are the parts that can be WRONG in a
 * way no rendering test would catch - which selection survives a whitelist
 * fetch, whether a set fits the machine - and because the unit suite runs in a
 * node environment that cannot import JSX at all. Anything here must stay pure:
 * no hooks, no fetch, no React.
 */
import { modelRequirement, usableVramGb, UNKNOWN_MODEL_VRAM_GB } from "@/lib/hardware";
import { lookupModel, residentVramGb, resolveModel, type CatalogEntry } from "@/lib/model-catalog";

/**
 * A whitelist row exactly as the indexer returns it.
 *
 * `id` is the on-chain identity - keccak256 of the tag - and the only thing the
 * registry actually stores. `name` is a label the indexer bolts on, and when a
 * model was whitelisted without its tag string there is nothing to bolt on, so
 * it echoes the id back into `name`. Carrying `id` is what lets us tell a real
 * tag apart from a digest wearing one's clothes.
 */
export interface LiveModel {
  id: string;
  name: string;
  fee: string; // wei
  max_output_tokens: number;
  /**
   * The boundary's own verdict on `name`: true when it is a placeholder rather
   * than a tag (see ModelInfo.unnamed in lib/subgraph.ts). Optional because a
   * hand-built row - a fixture, an older cached response - carries no flag, and
   * absence must not read as "unnamed".
   */
  unnamed?: boolean;
}

/** A live model resolved to an identity we can act on. */
export interface Row {
  /** Lowercase on-chain id. Unique per registry row, so it keys the list. */
  id: string;
  /** The real Ollama tag. null = the id never resolved, so it is NOT servable. */
  tag: string | null;
  label: string;
  fee: string; // wei
  maxOut: number;
  embedding: boolean;
  /** Resident GB to keep it warm, or null when we cannot size it honestly. */
  gb: number | null;
  /** Short descriptor for the second line, when we have one. */
  note: string | null;
}

export type ServableRow = Row & { tag: string };

export function isServable(r: Row): r is ServableRow {
  return r.tag !== null;
}

/** Sort key that keeps models we cannot size at the bottom of any ordering. */
export function sizeKey(r: Row): number {
  return r.gb ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Size + descriptor for a model.
 *
 * The catalog is measured (summed manifest layers, or an observed inference
 * peak), so it wins outright. A tag that is real but absent from the catalog -
 * a model whitelisted after this build shipped - falls back to hardware.ts's
 * name regex, which can only size a name that carries its parameter count.
 * Everything else has NO size: the registry stores none, and a keccak digest
 * says nothing about the weights behind it. null means "we do not know", and
 * the UI prints that instead of inventing a comfortable 8GB.
 */
function describe(tag: string | null, entry?: CatalogEntry): { gb: number | null; note: string | null } {
  if (entry) return { gb: residentVramGb(entry), note: entry.note ?? null };
  if (!tag) return { gb: null, note: null };
  const req = modelRequirement(tag);
  // Gate on `source`, NOT on `known`: `known` is false for a name-estimated
  // model too, so testing it here would throw away the very fallback this
  // branch exists for. Only "unknown" means the tag carried no size signal at
  // all, and that is the case we refuse to invent a number for.
  if (req.source === "unknown") return { gb: null, note: null };
  return { gb: req.vramGb, note: req.tierLabel };
}

export function toRow(m: LiveModel): Row {
  // Carry the boundary's verdict through rather than re-deriving it from the
  // string it produced. `resolveModel` is idempotent (it proves a name against
  // keccak(name) === id), so re-resolving a placeholder is safe TODAY - but the
  // picker should not be the thing that breaks if that ever stops holding, and
  // an explicit flag is a fact where a display string is only evidence. Feeding
  // "" for an unnamed row is the same convention lib/subgraph.ts uses when it
  // joins a worker's models: it asks the id, and nothing else.
  const unnamed = m.unnamed === true;
  const r = resolveModel(unnamed ? "" : m.name, m.id);
  // A row the indexer already told us has no published tag is not servable,
  // whatever a second resolution makes of it - and it gets no catalog data
  // either, so the row cannot end up unservable and confidently sized at once.
  const tag = unnamed ? null : r.tag;
  const entry = unnamed ? undefined : r.entry;
  const { gb, note } = describe(tag, entry);
  return {
    id: r.id ?? m.id.toLowerCase(),
    tag,
    label: r.label,
    fee: m.fee,
    maxOut: m.max_output_tokens,
    // The registry's own tell for an embedding model: it answers with vectors,
    // so its output cap is a single token. The catalog flags the ones we know.
    embedding: entry?.embedding === true || m.max_output_tokens === 1,
    gb,
    note,
  };
}

/**
 * Does a stored selection name this row? Setup stores TAGS (they become the
 * container's SUPPORTED_MODELS), but a record written before ids and tags were
 * told apart can hold the id it was shown. Match on either identity so such a
 * record still lights up the right row - we always hand the TAG back out.
 */
export function names(stored: string[], r: Row): boolean {
  return stored.some((v) => {
    const s = v.trim().toLowerCase();
    return s === r.id || (r.tag !== null && s === r.tag.toLowerCase());
  });
}

/**
 * Decide the selection that should be in effect once the live whitelist lands.
 *
 * Rules, in order:
 *  1. LOCKED models survive unconditionally. They are what the worker already
 *     serves, so dropping one is not tidying up - it turns the update panel's
 *     diff into a REMOVAL, and removals are refused there (you cannot stop
 *     serving a model live without deregistering), which disables Apply for
 *     good. A locked model that has since left the whitelist, or whose tag we
 *     cannot recover, is kept verbatim for exactly that reason.
 *  2. A non-locked selection survives only if it maps to a servable live row,
 *     and is re-emitted as that row's TAG - healing a record that stored an
 *     on-chain id, and dropping one we could never `ollama pull`.
 *  3. Only when that leaves nothing do we auto-pick, and only from servable
 *     rows: the lightest one that fits `room`, else the lightest overall.
 *
 * Returns the selection to apply. An empty array means "we have nothing safe to
 * offer" - the caller must then leave the existing selection alone rather than
 * clearing it.
 */
export function reconcileSelection(rows: Row[], value: string[], locked: string[], room: number): string[] {
  const servable = rows.filter(isServable);
  const kept: string[] = [];
  const push = (t: string) => {
    if (!kept.some((k) => k.toLowerCase() === t.toLowerCase())) kept.push(t);
  };

  for (const v of locked) {
    // Prefer the live row's tag, then the catalog's, then the string itself -
    // never nothing. The first two heal a stored id into something pullable;
    // the last keeps a model we cannot name in the set it is already serving.
    const row = rows.find((r) => names([v], r));
    push(row?.tag ?? lookupModel(v)?.tag ?? v);
  }
  for (const v of value) {
    const row = servable.find((r) => names([v], r));
    if (row) push(row.tag);
  }

  if (kept.length > 0) return kept;
  if (servable.length === 0) return []; // nothing here is safe to pick - the UI says so
  // Unsized models sort last: we won't volunteer a model we cannot measure
  // over one we can.
  const fits: ServableRow[] = room > 0 ? servable.filter((r) => r.gb !== null && r.gb <= room) : [];
  const pool: ServableRow[] = fits.length ? fits : servable;
  return [pool.slice().sort((a, b) => sizeKey(a) - sizeKey(b))[0].tag];
}

/** What a selection costs, and how much of that cost we actually know. */
export interface Footprint {
  /** Sum of the sizes we know. A FLOOR when `unsized > 0`, not an estimate. */
  total: number;
  /** How many selected models publish no size at all. */
  unsized: number;
  /**
   * The number the fit check must use: every unsized model charged at
   * UNKNOWN_MODEL_VRAM_GB. A keccak id could be a 0.6B embedder or a 120B MoE,
   * so counting it as 0 - which is what totalling only known sizes does - is
   * the one assumption that can quietly overcommit the machine.
   */
  worst: number;
}

export function selectionFootprint(rows: Row[], value: string[]): Footprint {
  let total = 0;
  let unsized = 0;
  for (const v of value) {
    // Prefer the live row; a selection that is no longer whitelisted (but is
    // still served by the running worker) still costs memory, so size it from
    // the catalog by name rather than dropping it from the sum.
    const row = rows.find((r) => names([v], r));
    const gb = row ? row.gb : describe(v, lookupModel(v)).gb;
    if (gb === null) unsized += 1;
    else total += gb;
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return { total: round(total), unsized, worst: round(total + unsized * UNKNOWN_MODEL_VRAM_GB) };
}

/**
 * What we know about this machine's memory - three states, not two.
 *
 * "The user told us there is no dedicated GPU" is a FACT, and reporting it as
 * "your memory could not be read" both misdescribes it and switches off every
 * per-model size line the CPU-only user most needs to see. Only a detection
 * that came back with nothing is genuinely unknown.
 */
export type MemoryState =
  | { kind: "gpu"; avail: number; usable: number }
  | { kind: "cpu"; avail: 0; usable: 0 }
  | { kind: "unknown"; avail: 0; usable: 0 };

export function memoryStateOf(vramGb: number, vramKnown: boolean): MemoryState {
  if (!vramKnown) return { kind: "unknown", avail: 0, usable: 0 };
  // A read that says 0 is a machine with no discrete GPU, not a failed read.
  if (!(vramGb > 0)) return { kind: "cpu", avail: 0, usable: 0 };
  // What a model can actually have. See OS_VRAM_OVERHEAD_GB in lib/hardware.ts.
  return { kind: "gpu", avail: vramGb, usable: usableVramGb(vramGb) };
}
