"use client";

import { useEffect, useMemo, useState } from "react";
import { Box, Check, CircleAlert, AlertTriangle } from "lucide-react";
// OS_VRAM_OVERHEAD_GB / usableVramGb are imported rather than redefined here:
// the desktop's claim on VRAM is one number, and a picker that reserved a
// different amount than the fit helpers would show a plan it then contradicts.
import { modelRequirement, usableVramGb, OS_VRAM_OVERHEAD_GB } from "@/lib/hardware";
import { lookupModel, residentVramGb, resolveModel, type CatalogEntry } from "@/lib/model-catalog";
import { fromWei, cn } from "@/lib/utils";
import type { NetworkId } from "@/lib/network";

/**
 * A whitelist row exactly as the indexer returns it.
 *
 * `id` is the on-chain identity - keccak256 of the tag - and the only thing the
 * registry actually stores. `name` is a label the indexer bolts on, and when a
 * model was whitelisted without its tag string there is nothing to bolt on, so
 * it echoes the id back into `name`. Carrying `id` is what lets us tell a real
 * tag apart from a digest wearing one's clothes.
 */
interface LiveModel {
  id: string;
  name: string;
  fee: string; // wei
  max_output_tokens: number;
}

/** A live model resolved to an identity we can act on. */
interface Row {
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

type ServableRow = Row & { tag: string };

function isServable(r: Row): r is ServableRow {
  return r.tag !== null;
}

/** Sort key that keeps models we cannot size at the bottom of any ordering. */
function sizeKey(r: Row): number {
  return r.gb ?? Number.MAX_SAFE_INTEGER;
}

/** One decimal, without dragging a ".0" onto whole numbers. */
function fmtGb(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** 16384 -> "16,384". Rendered only after a client fetch, so the locale is fixed. */
function fmtTokens(n: number): string {
  return n.toLocaleString("en-US");
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

function toRow(m: LiveModel): Row {
  const r = resolveModel(m.name, m.id);
  const { gb, note } = describe(r.tag, r.entry);
  return {
    id: r.id ?? m.id.toLowerCase(),
    tag: r.tag,
    label: r.label,
    fee: m.fee,
    maxOut: m.max_output_tokens,
    // The registry's own tell for an embedding model: it answers with vectors,
    // so its output cap is a single token. The catalog flags the ones we know.
    embedding: r.entry?.embedding === true || m.max_output_tokens === 1,
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
function names(stored: string[], r: Row): boolean {
  return stored.some((v) => {
    const s = v.trim().toLowerCase();
    return s === r.id || (r.tag !== null && s === r.tag.toLowerCase());
  });
}

/**
 * Choose which model(s) the worker serves. The list is the selected network's
 * live whitelist (so it grows as the registry adds models). A worker can serve
 * several at once, but every model it picks must stay resident in memory at the
 * same time, so we sum their rough footprints and warn when the set won't fit the
 * detected machine (a cold-load mid-job is what gets a worker slashed).
 *
 * Selection is keyed on the on-chain id, never on the displayed name: for most
 * of the live registry the indexer's `name` IS the id, and treating that string
 * as a tag is what would stake LCAI and register for a model this machine can
 * never pull. What leaves through `onChange` is always a real tag.
 */
export function ModelPicker({
  network,
  vramGb,
  vramKnown = true,
  value,
  onChange,
  locked = [],
}: {
  network: NetworkId;
  vramGb: number;
  // False when VRAM could not be read at all. We then check nothing against it,
  // rather than silently measuring every model against 0GB and flagging them all.
  vramKnown?: boolean;
  value: string[];
  onChange: (models: string[]) => void;
  // Models that are already committed and can't be unselected here (e.g. a
  // running worker's current set - you can add, but dropping one needs deregister).
  locked?: string[];
}) {
  const [models, setModels] = useState<LiveModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    setLoading(true);
    fetch(`/api/models?net=${network}`)
      .then((r) => r.json())
      .then((j) => {
        if (!on || !j.ok) return;
        const live: LiveModel[] = (j.models ?? [])
          .filter((m: LiveModel & { is_enabled: boolean; is_whitelisted: boolean }) => m.is_enabled && m.is_whitelisted)
          .map((m: LiveModel) => ({
            // Keep the id: it is the identity, and `name` may be a copy of it.
            id: (m.id ?? "").toLowerCase(),
            name: m.name,
            fee: m.fee,
            max_output_tokens: m.max_output_tokens,
          }));
        setModels(live);

        // Reconcile the current selection against what's live. Only rows whose
        // tag we recovered can survive: a selection we cannot name is one we
        // cannot `ollama pull`, and staking for it registers an id the worker
        // will never serve. Re-emitting the TAG also heals a stored id.
        const rows = live.map(toRow);
        const servable = rows.filter(isServable);
        if (servable.length === 0) return; // nothing here is safe to pick - say so in the UI
        const kept: string[] = [];
        for (const v of value) {
          const row = servable.find((r) => names([v], r));
          if (row && !kept.includes(row.tag)) kept.push(row.tag);
        }
        if (kept.length === 0) {
          // Auto-pick the lightest model that actually fits, from the servable
          // set only. Unsized models sort last: we won't volunteer a model we
          // cannot measure over one we can.
          const room = vramKnown ? usableVramGb(vramGb) : 0;
          const fits: ServableRow[] = room > 0 ? servable.filter((r) => r.gb !== null && r.gb <= room) : [];
          const pool: ServableRow[] = fits.length ? fits : servable;
          const best = pool.slice().sort((a, b) => sizeKey(a) - sizeKey(b))[0];
          onChange([best.tag]);
        } else if (kept.join(",") !== value.join(",")) {
          onChange(kept);
        }
      })
      .catch(() => {})
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  // Servable models first, then smallest first - so the rows a user can act on
  // lead, and the ones we cannot name sink to the bottom where they belong.
  const rows = useMemo(
    () =>
      models.map(toRow).sort((a, b) => Number(isServable(b)) - Number(isServable(a)) || sizeKey(a) - sizeKey(b)),
    [models],
  );

  const memKnown = vramKnown && vramGb > 0;
  const avail = memKnown ? vramGb : 0;
  // What a model can actually have. See OS_VRAM_OVERHEAD_GB in lib/hardware.ts.
  const usable = memKnown ? usableVramGb(avail) : 0;

  const selection = useMemo(() => {
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
    return { total: Math.round(total * 10) / 10, unsized };
  }, [value, rows]);

  const over = memKnown && selection.total > usable;
  const noneServable = rows.length > 0 && !rows.some(isServable);

  const toggle = (r: Row) => {
    // An id we could not name is not a tag. Selecting it would stake and
    // register for a model that can never be pulled, so there is nothing here
    // to toggle - the button is disabled too, this is the belt.
    if (!isServable(r)) return;
    if (names(locked, r)) return; // committed - can't unselect here
    if (names(value, r)) {
      if (value.length === 1) return; // keep at least one selected
      onChange(value.filter((v) => !names([v], r)));
    } else {
      onChange([...value, r.tag]);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-content-soft">
        <Box className="size-4" />
        <span className="text-sm font-medium">Models to serve</span>
        <span className="text-xs">your worker serves every model you pick</span>
      </div>

      {loading && rows.length === 0 ? (
        <div className="h-16 animate-pulse rounded-xl border border-bdr-soft bg-card/50" />
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-bdr-soft bg-card/50 p-3 text-sm text-content-soft">
          No live models on {network} right now. Setup will use the default once one is whitelisted.
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {rows.map((r) => {
              const servable = isServable(r);
              const selected = names(value, r);
              const isLocked = names(locked, r);
              // Measured against USABLE memory, not the sticker total - a model
              // that only fits the total is the one that gets evicted mid-job.
              const tooBig = memKnown && r.gb !== null && r.gb > usable;
              // Never let one click stake for a model this machine cannot hold,
              // or for an id we cannot turn into a pullable tag. An oversized
              // model that is ALREADY selected stays clickable so it can be dropped.
              const blocked = !servable || (tooBig && !selected);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggle(r)}
                  aria-pressed={selected}
                  disabled={isLocked || blocked}
                  title={
                    !servable
                      ? r.id
                      : isLocked
                        ? "Already serving this - it can't be removed here"
                        : tooBig && !selected
                          ? `Needs about ${fmtGb(r.gb ?? 0)}GB resident, and only about ${fmtGb(usable)}GB is usable here.`
                          : undefined
                  }
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-left transition-all",
                    selected
                      ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30"
                      : "border-bdr-soft bg-card/50",
                    !selected && !isLocked && !blocked && "hover:border-primary/40",
                    isLocked && "cursor-default opacity-90",
                    blocked && "cursor-not-allowed opacity-55",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border",
                      selected ? "border-primary bg-primary text-white" : "border-bdr-soft",
                    )}
                  >
                    {selected && <Check className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-sm font-medium text-content-primary" title={r.id}>
                        {r.label}
                        {isLocked && <span className="ml-1.5 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">serving</span>}
                        {servable && r.embedding && (
                          <span className="ml-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">embeddings</span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-content-soft">{fromWei(r.fee)} LCAI</span>
                    </span>
                    {servable ? (
                      <span className="mt-1 flex items-center gap-1.5 text-[11px]">
                        {r.gb === null ? (
                          <span className="text-content-soft">size unknown</span>
                        ) : !memKnown ? (
                          // We know the model's footprint but not the machine's,
                          // so state the number without a verdict on the fit.
                          <span className="tabular-nums text-content-soft">~{fmtGb(r.gb)}GB resident</span>
                        ) : tooBig ? (
                          <span className="inline-flex items-center gap-1 text-warning">
                            <CircleAlert className="size-3" /> Needs ~{fmtGb(r.gb)}GB
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-success">
                            <Check className="size-3" /> ~{fmtGb(r.gb)}GB
                          </span>
                        )}
                        {r.maxOut > 0 && (
                          <>
                            <span aria-hidden className="h-3 w-px bg-bdr-soft" />
                            <span className="shrink-0 text-content-soft">
                              {r.embedding ? "vectors, not chat" : `${fmtTokens(r.maxOut)} tokens out`}
                            </span>
                          </>
                        )}
                        {r.note && (
                          <>
                            <span aria-hidden className="h-3 w-px bg-bdr-soft" />
                            <span className="min-w-0 truncate text-content-soft">{r.note}</span>
                          </>
                        )}
                      </span>
                    ) : (
                      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-content-soft">
                        <CircleAlert className="size-3 shrink-0" />
                        Name not published on chain - can&apos;t be pulled or served.
                      </span>
                    )}
                    {tooBig && !selected && servable && (
                      <span className="mt-1 block text-[11px] text-warning">
                        Larger than this machine&apos;s usable memory on its own.
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {noneServable && (
            <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed text-content-default">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span>
                Every model on {network} is registered by id only, with no published name. There is no tag to pull, so
                none of them can be served from here yet.
              </span>
            </p>
          )}

          {/* memory gate */}
          <div className={cn("mt-3 rounded-xl border p-3 text-xs", over ? "border-warning/40 bg-warning/10" : "border-bdr-soft bg-surface-base-subtle/40")}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-content-soft">
                Memory to keep {value.length === 1 ? "it" : "them all"} warm
              </span>
              <span className="font-semibold tabular-nums text-content-primary">
                ~{fmtGb(selection.total)}GB{memKnown && ` of ~${fmtGb(avail)}GB`}
              </span>
            </div>
            {over && (
              <p className="mt-2 flex items-start gap-1.5 text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                These models need about {fmtGb(selection.total)}GB resident at once, but only about {fmtGb(usable)}GB is
                usable here. They would cold-load between jobs and risk a slash. Deselect one, or run them on a bigger
                machine.
              </p>
            )}
            {/* The card's total is never all yours - be explicit about what is
                left. The `over` warning already quotes the usable figure, so
                only state it here when that warning isn't showing. */}
            {memKnown && !over && (
              <p className="mt-1.5 text-content-soft">
                Your desktop session (compositor, browser, this app) holds roughly {fmtGb(OS_VRAM_OVERHEAD_GB)}GB of
                that, so plan against about {fmtGb(usable)}GB.
              </p>
            )}
            {!memKnown && (
              <p className="mt-1.5 text-content-soft">
                This machine&apos;s memory could not be read, so nothing above is checked against it. Confirm the set
                fits before you install.
              </p>
            )}
            {selection.unsized > 0 && (
              <p className="mt-1.5 text-content-soft">
                {selection.unsized === 1 ? "One selected model publishes" : `${selection.unsized} selected models publish`} no
                size, so {selection.unsized === 1 ? "it is" : "they are"} not counted in that total.
              </p>
            )}
            {!over && value.length > 1 && (
              <p className="mt-1.5 text-content-soft">
                Your worker will advertise all {value.length} and earn from each job type. They stay loaded together.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
