import { describe, it, expect } from "vitest";
import {
  memoryStateOf,
  reconcileSelection,
  selectionFootprint,
  toRow,
  type LiveModel,
  type Row,
} from "@/components/onboard/model-picker-logic";
import { modelIdForTag } from "@/lib/model-catalog";
import { UNKNOWN_MODEL_VRAM_GB, usableVramGb } from "@/lib/hardware";

/** A whitelist row as the models API hands it over, named unless told otherwise. */
function live(tag: string, over: Partial<LiveModel> = {}): LiveModel {
  return { id: modelIdForTag(tag), name: tag, fee: "0", max_output_tokens: 4096, ...over };
}

/** A registry row that was whitelisted with no tag string: id only. */
function unnamedLive(id: string): LiveModel {
  return { id, name: `unnamed ${id.slice(0, 10)}…`, fee: "0", max_output_tokens: 4096, unnamed: true };
}

const GEMMA = "gemma4:e2b"; // 1.7GB resident (MoE)
const OSS20 = "gpt-oss:20b"; // 12.7GB resident
const OSS120 = "gpt-oss:120b"; // 59.9GB resident
const rowsOf = (...m: LiveModel[]): Row[] => m.map(toRow);

describe("toRow", () => {
  it("carries the boundary's `unnamed` verdict instead of re-deriving it", () => {
    // The placeholder LOOKS like a name; only the flag says it is not one.
    const r = toRow(unnamedLive("0x" + "ab".repeat(32)));
    expect(r.tag).toBeNull();
    expect(r.gb).toBeNull();
  });

  it("refuses to serve an unnamed row even when its name would resolve", () => {
    // A row flagged unnamed whose name is a real tag: the flag wins, because a
    // display string is evidence and the flag is a fact.
    const r = toRow(live(GEMMA, { unnamed: true }));
    expect(r.tag).toBeNull();
    // And it gets no catalog data either: a row cannot read as unservable and
    // confidently sized at the same time.
    expect(r.gb).toBeNull();
  });

  it("still resolves a row with no flag at all (older cache, hand-built fixture)", () => {
    const r = toRow({ id: modelIdForTag(GEMMA), name: GEMMA, fee: "0", max_output_tokens: 4096 });
    expect(r.tag).toBe(GEMMA);
    expect(r.gb).toBe(1.7);
  });
});

describe("reconcileSelection", () => {
  const rows = rowsOf(live(GEMMA), live(OSS20), live(OSS120));
  const room = usableVramGb(16);

  it("keeps every locked model when the caller's value is still empty", () => {
    // The bug this exists for: the picker reconciled against a stale, empty
    // `value` and replaced the running worker's set with one auto-pick. That
    // reads downstream as a REMOVAL, which disables Apply for good.
    expect(reconcileSelection(rows, [], [OSS20], room)).toEqual([OSS20]);
  });

  it("never drops a locked model that has left the whitelist", () => {
    // Not in `rows` at all - still being served, so still in the set.
    expect(reconcileSelection(rows, [], ["llama3-70b"], room)).toEqual(["llama3-70b"]);
  });

  it("never drops a locked model whose tag we cannot recover", () => {
    const id = "0x" + "cd".repeat(32);
    expect(reconcileSelection(rowsOf(live(GEMMA), unnamedLive(id)), [], [id], room)).toEqual([id]);
  });

  it("keeps the locked set and the added model, locked first, without duplicating", () => {
    expect(reconcileSelection(rows, [OSS20, GEMMA], [OSS20], room)).toEqual([OSS20, GEMMA]);
  });

  it("heals a stored on-chain id into the tag, for locked and selected alike", () => {
    const next = reconcileSelection(rows, [modelIdForTag(GEMMA)], [modelIdForTag(OSS20)], room);
    expect(next).toEqual([OSS20, GEMMA]);
  });

  it("leaves an unchanged selection byte-identical, so the caller emits nothing", () => {
    const value = [OSS20];
    expect(reconcileSelection(rows, value, value, room).join(",")).toBe(value.join(","));
  });

  it("drops a non-locked selection we could never pull", () => {
    const id = "0x" + "ef".repeat(32);
    // Nothing survives, so it falls through to the auto-pick rather than
    // staking for an id the worker can never serve.
    expect(reconcileSelection(rows, [id], [], room)).toEqual([GEMMA]);
  });

  it("auto-picks the lightest model that fits only when nothing was kept", () => {
    expect(reconcileSelection(rows, [], [], room)).toEqual([GEMMA]);
  });

  it("auto-picks the lightest overall when nothing fits the machine", () => {
    expect(reconcileSelection(rowsOf(live(OSS20), live(OSS120)), [], [], usableVramGb(4))).toEqual([OSS20]);
  });

  it("returns nothing when no row is servable and nothing is locked", () => {
    // The caller must then leave the existing selection alone.
    expect(reconcileSelection(rowsOf(unnamedLive("0x" + "11".repeat(32))), [], [], room)).toEqual([]);
  });
});

describe("selectionFootprint", () => {
  const rows = rowsOf(live(GEMMA), live(OSS20));

  it("sums the sizes it knows", () => {
    const f = selectionFootprint(rows, [GEMMA, OSS20]);
    expect(f).toEqual({ total: 14.4, unsized: 0, worst: 14.4 });
  });

  it("charges an unsized model the largest footprint we know of", () => {
    // Counting it as 0 - the old behaviour - made it invisible to the gate.
    const f = selectionFootprint(rows, [GEMMA, "0x" + "22".repeat(32)]);
    expect(f.total).toBe(1.7);
    expect(f.unsized).toBe(1);
    expect(f.worst).toBe(Math.round((1.7 + UNKNOWN_MODEL_VRAM_GB) * 10) / 10);
  });

  it("makes an unsized selection trip the gate on a 16GB card", () => {
    const usable = usableVramGb(16);
    const f = selectionFootprint(rows, ["0x" + "33".repeat(32)]);
    expect(f.total > usable).toBe(false); // what the old total-based check saw
    expect(f.worst > usable).toBe(true); // what the fixed check sees
  });

  it("sizes a selection that has left the whitelist from the catalog", () => {
    expect(selectionFootprint([], [OSS20]).total).toBe(12.7);
  });
});

describe("memoryStateOf", () => {
  it("reports a real GPU with its usable share", () => {
    expect(memoryStateOf(16, true)).toEqual({ kind: "gpu", avail: 16, usable: usableVramGb(16) });
  });

  it("distinguishes an explicit CPU-only machine from a failed reading", () => {
    // "No dedicated GPU / CPU only" is a fact the user selected, not a failure.
    expect(memoryStateOf(0, true).kind).toBe("cpu");
    expect(memoryStateOf(0, false).kind).toBe("unknown");
  });
});
