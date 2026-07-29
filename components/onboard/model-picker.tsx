"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Check, CircleAlert, AlertTriangle } from "lucide-react";
// OS_VRAM_OVERHEAD_GB is imported rather than redefined here: the desktop's
// claim on VRAM is one number, and a picker that reserved a different amount
// than the fit helpers would show a plan it then contradicts.
import { OS_VRAM_OVERHEAD_GB, UNKNOWN_MODEL_VRAM_GB } from "@/lib/hardware";
// The decisions this picker makes live next door, in plain TypeScript: which
// selection survives a whitelist fetch and whether a set fits are the parts
// that can be silently wrong, and the unit suite cannot import JSX to test them.
import {
  isServable,
  memoryStateOf,
  names,
  reconcileSelection,
  selectionFootprint,
  sizeKey,
  toRow,
  type LiveModel,
  type Row,
} from "@/components/onboard/model-picker-logic";
import { fromWei, cn } from "@/lib/utils";
import type { NetworkId } from "@/lib/network";

/** One decimal, without dragging a ".0" onto whole numbers. */
function fmtGb(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** 16384 -> "16,384". Rendered only after a client fetch, so the locale is fixed. */
function fmtTokens(n: number): string {
  return n.toLocaleString("en-US");
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

  const mem = useMemo(() => memoryStateOf(vramGb, vramKnown), [vramGb, vramKnown]);
  const onGpu = mem.kind === "gpu";
  const { avail, usable } = mem;

  // Mirrors of the mutable props, for the reconcile below.
  //
  // That reconcile runs inside an async `.then`, and the effect around it
  // deliberately re-runs only when the NETWORK changes - refetching the whole
  // whitelist on every click would be absurd. A plain closure therefore pins
  // the MOUNT render's props forever, and in the update panel those are
  // `value: []` with `locked: []`: the fetch then found nothing to keep,
  // auto-picked the lightest model, and emitted it as the whole selection.
  // That reads downstream as one addition plus N removals of the models the
  // worker is actually serving, and removals disable Apply permanently. Refs
  // are the window onto the CURRENT render; adding the props to the dep array
  // is not a fix, because it would re-fetch on every selection change.
  //
  // Assigned during render rather than in an effect on purpose: a promise
  // resolving between render and the passive-effect flush would otherwise read
  // one render behind. They are pure mirrors of props, so re-assigning them is
  // idempotent and safe to repeat.
  const valueRef = useRef(value);
  const lockedRef = useRef(locked);
  const onChangeRef = useRef(onChange);
  const roomRef = useRef(usable);
  valueRef.current = value;
  lockedRef.current = locked;
  onChangeRef.current = onChange;
  roomRef.current = usable;

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
            // The boundary already decided whether `name` is a tag or a
            // placeholder - carry that verdict instead of re-deriving it.
            unnamed: m.unnamed,
          }));
        setModels(live);

        // Reconcile the selection against what's live: heal a stored id into a
        // pullable tag, drop anything we could never `ollama pull`, keep every
        // locked model whatever happens. Reading the refs, not the closure.
        const rows = live.map(toRow);
        const next = reconcileSelection(rows, valueRef.current, lockedRef.current, roomRef.current);
        // An empty result means nothing here was safe to offer - leave the
        // caller's selection alone rather than clearing it.
        if (next.length > 0 && next.join(",") !== valueRef.current.join(",")) onChangeRef.current(next);
      })
      .catch(() => {})
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
    // No exhaustive-deps suppression any more: everything mutable this effect
    // touches goes through a ref, so `network` really is the whole dependency
    // set. The suppression is what used to hide the stale closure above.
  }, [network]);

  // Servable models first, then smallest first - so the rows a user can act on
  // lead, and the ones we cannot name sink to the bottom where they belong.
  const rows = useMemo(
    () =>
      models.map(toRow).sort((a, b) => Number(isServable(b)) - Number(isServable(a)) || sizeKey(a) - sizeKey(b)),
    [models],
  );

  const selection = useMemo(() => selectionFootprint(rows, value), [value, rows]);

  // Checked against the WORST case, not the known sum: a model we cannot size
  // adds 0 to `total`, so gating on that total is how an unsized selection made
  // itself invisible to this warning. `worst` charges each one the largest
  // footprint we know of, which is what UNKNOWN_MODEL_VRAM_GB is for.
  const over = onGpu && selection.worst > usable;
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
              const tooBig = onGpu && r.gb !== null && r.gb > usable;
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
                        ) : mem.kind === "cpu" ? (
                          // No GPU to fit it into: the number is real, it just
                          // lands in system RAM. State it, don't judge it.
                          <span className="tabular-nums text-content-soft">~{fmtGb(r.gb)}GB in system RAM</span>
                        ) : !onGpu ? (
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
                {/* "at least" because an unsized model contributes nothing to
                    this sum - the figure is a floor, and saying "~" would sell
                    it as an estimate. */}
                {selection.unsized > 0 && <span className="font-normal text-content-soft">at least </span>}
                ~{fmtGb(selection.total)}GB{onGpu && ` of ~${fmtGb(avail)}GB`}
              </span>
            </div>
            {over && (
              <p className="mt-2 flex items-start gap-1.5 text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {selection.unsized > 0 ? (
                  <span>
                    {selection.unsized === 1 ? "One selected model publishes" : `${selection.unsized} selected models publish`} no
                    size, so this set cannot be shown to fit: a model we cannot measure could need anything up to ~
                    {fmtGb(UNKNOWN_MODEL_VRAM_GB)}GB, and only about {fmtGb(usable)}GB is usable here. Pick models with a
                    known footprint, or verify by hand before you install - a set that cold-loads mid-job risks a slash.
                  </span>
                ) : (
                  <span>
                    These models need about {fmtGb(selection.total)}GB resident at once, but only about {fmtGb(usable)}GB
                    is usable here. They would cold-load between jobs and risk a slash. Deselect one, or run them on a
                    bigger machine.
                  </span>
                )}
              </p>
            )}
            {/* The card's total is never all yours - be explicit about what is
                left. The `over` warning already quotes the usable figure, so
                only state it here when that warning isn't showing. */}
            {onGpu && !over && (
              <p className="mt-1.5 text-content-soft">
                Your desktop session (compositor, browser, this app) holds roughly {fmtGb(OS_VRAM_OVERHEAD_GB)}GB of
                that, so plan against about {fmtGb(usable)}GB.
              </p>
            )}
            {/* Three states, not two: "you told us there is no GPU" is a fact
                we should repeat back, not report as a failed reading. */}
            {mem.kind === "cpu" && (
              <p className="mt-1.5 text-content-soft">
                No dedicated GPU, so these run on the CPU out of system RAM - the sizes above are what they need there,
                and there is no VRAM figure to check them against. Expect slow inference, which can miss a job deadline.
              </p>
            )}
            {mem.kind === "unknown" && (
              <p className="mt-1.5 text-content-soft">
                This machine&apos;s memory could not be read, so nothing above is checked against it. Confirm the set
                fits before you install.
              </p>
            )}
            {/* When `over` is showing it has already made this point, in stronger terms. */}
            {selection.unsized > 0 && !over && (
              <p className="mt-1.5 text-content-soft">
                {selection.unsized === 1 ? "One selected model publishes" : `${selection.unsized} selected models publish`} no
                size, so {selection.unsized === 1 ? "it is" : "they are"} not in that total - treat it as a floor.{" "}
                {selection.unsized === 1 ? "It" : "They"} could need up to ~{fmtGb(UNKNOWN_MODEL_VRAM_GB)}GB
                {selection.unsized === 1 ? "" : " each"}, which is the largest model we know of.
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
