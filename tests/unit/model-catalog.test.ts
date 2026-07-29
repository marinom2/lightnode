import { describe, it, expect } from "vitest";
import {
  MODEL_CATALOG,
  ENTRY_BY_ID,
  ENTRY_BY_TAG,
  modelIdForTag,
  isModelId,
  resolveModel,
  residentVramGb,
  lookupModel,
  type CatalogEntry,
} from "@/lib/model-catalog";

/**
 * The ten model ids the testnet registry actually holds, paired with the tag
 * that hashes to each one.
 *
 * These pins are ground truth, not expectations: the ids were read off chain and
 * the tags were confirmed against them. keccak256 is one-way, so a pair is the
 * only evidence that a catalog tag is spelled exactly as it was registered - one
 * wrong character (":8b" vs "-8b", "4.7" vs "4-7") yields a completely unrelated
 * digest and the model silently stops resolving, which is precisely the failure
 * lib/model-catalog.ts exists to prevent. If a case here fails, the catalog
 * drifted; do not edit the id.
 *
 * `downloadGb` is the summed registry.ollama.ai manifest layer size, pinned for
 * the same reason: sizes here are measured, and nothing in a tag string implies
 * a footprint, so a "cleanup" must never be able to re-guess one.
 */
const GROUND_TRUTH: ReadonlyArray<{ tag: string; id: string; downloadGb: number }> = [
  { tag: "qwen3-embedding:0.6b", id: "0xde701c92d38c91686d6f7f44f9b634b3adf16b8e79bb9094abfec66180a18f67", downloadGb: 0.6 },
  { tag: "llama3-8b", id: "0xf4a414fa51803433e9197f32cda96d5cb2ac8269c481eb0262fe2dd11f428848", downloadGb: 4.7 },
  { tag: "qwen3-vl:8b", id: "0xab5055d54803561873a25c21f4cc853371b17b69620b39b2ecca824c259b2ff3", downloadGb: 6.1 },
  { tag: "gemma4:e2b", id: "0x264fdec586bc9c5f17becd6ead7e43cb69aa68a9dd6dea3dbbeca8c8717325d1", downloadGb: 7.2 },
  { tag: "gpt-oss:20b", id: "0x812058e1dbc4b7ee2b5c8db96cd83bdc110740ae43d3fa4ee116e7e38e2ea802", downloadGb: 13.8 },
  { tag: "glm-4.7-flash", id: "0x35f686ade96649d2bf47e024eca280619fc80458c5cdece4804fc3f1561bd542", downloadGb: 19.0 },
  { tag: "qwen3-vl:30b", id: "0x18db253105a3231f058bd6a14970d9230a64a9e54df29e47cc5c6c355c1a84ca", downloadGb: 19.6 },
  { tag: "llama3-70b", id: "0x665d85c3b24f6a5cb91f90ec2e215d6155531158ff7ba81dfd182ecfab1dd4cf", downloadGb: 40.0 },
  { tag: "qwen3-coder-next", id: "0x2484d762220e965130f8e0c0bda116929bd8d4dd281de3c11cc93ac556ccc927", downloadGb: 51.7 },
  { tag: "gpt-oss:120b", id: "0x7519e6b291d1e88ee9c045dce2d1e9db92a3bba4ed967be12426b3c71bbc7c98", downloadGb: 65.4 },
];

/**
 * Catalog lookup that fails the test instead of returning undefined, so the
 * assertions below stay free of non-null assertions under `strict`.
 */
function requireEntry(tag: string): CatalogEntry {
  const entry = ENTRY_BY_TAG.get(tag);
  if (!entry) throw new Error(`catalog is missing "${tag}"`);
  return entry;
}

describe("modelIdForTag", () => {
  for (const { tag, id } of GROUND_TRUTH) {
    it(`hashes ${tag} to its live registry id`, () => {
      expect(modelIdForTag(tag)).toBe(id);
    });
  }

  it("covers the live registry exactly - nothing missing, nothing invented", () => {
    // Coverage matters in both directions. A missing tag means the UI renders a
    // raw 66-char hash for a model that IS whitelisted; an extra tag means we
    // offer a model no worker can actually be paid for.
    expect(MODEL_CATALOG.map((e) => e.tag).sort()).toEqual(GROUND_TRUTH.map((g) => g.tag).sort());
  });

  it("hashes the tag byte-for-byte - no case folding, no trimming", () => {
    // The lookup maps lowercase their *keys*, but the digest is over the tag
    // verbatim. Normalising before hashing would mint a second, bogus id that
    // matches nothing on chain, so these must stay distinct.
    expect(modelIdForTag("LLAMA3-8B")).not.toBe(modelIdForTag("llama3-8b"));
    expect(modelIdForTag(" llama3-8b")).not.toBe(modelIdForTag("llama3-8b"));
  });

  it("always emits a lowercase 32-byte digest", () => {
    // Every consumer keys maps by this string, so a mixed-case return would turn
    // into silent lookup misses rather than a visible error.
    for (const entry of MODEL_CATALOG) {
      const id = modelIdForTag(entry.tag);
      expect(isModelId(id)).toBe(true);
      expect(id).toBe(id.toLowerCase());
    }
  });
});

describe("catalog indexes", () => {
  it("gives every entry a unique id and a unique tag", () => {
    // Both maps are built by reducing the array, so a duplicated tag (or the
    // vanishingly unlikely keccak collision) would silently drop an entry
    // instead of throwing. Size equality is the cheapest way to catch that.
    expect(ENTRY_BY_ID.size).toBe(MODEL_CATALOG.length);
    expect(ENTRY_BY_TAG.size).toBe(MODEL_CATALOG.length);
  });

  it("keys ENTRY_BY_ID by modelIdForTag(tag) and ENTRY_BY_TAG by the tag", () => {
    for (const entry of MODEL_CATALOG) {
      expect(ENTRY_BY_ID.get(modelIdForTag(entry.tag))).toBe(entry);
      expect(ENTRY_BY_TAG.get(entry.tag.toLowerCase())).toBe(entry);
    }
  });
});

describe("isModelId", () => {
  it("accepts a 32-byte hex digest in either case, padding included", () => {
    // GraphQL/env/CLI strings arrive with stray whitespace and inconsistent
    // casing; the predicate trims and is case-insensitive on the digest body.
    const id = modelIdForTag("llama3-8b");
    expect(isModelId(id)).toBe(true);
    expect(isModelId(`0x${id.slice(2).toUpperCase()}`)).toBe(true);
    expect(isModelId(`  ${id}\n`)).toBe(true);
  });

  it("rejects tags, wrong-length hex and non-hex", () => {
    // This predicate is the gate that decides "is this an id or a servable tag",
    // so a false positive would send a hash to `ollama pull`.
    expect(isModelId("llama3-8b")).toBe(false);
    expect(isModelId("gpt-oss:20b")).toBe(false);
    expect(isModelId(`0x${"a".repeat(63)}`)).toBe(false); // 31.5 bytes
    expect(isModelId(`0x${"a".repeat(65)}`)).toBe(false); // 32.5 bytes
    expect(isModelId("a".repeat(64))).toBe(false); // no 0x prefix
    expect(isModelId(`0x${"g".repeat(64)}`)).toBe(false); // right length, not hex
    expect(isModelId("")).toBe(false);
  });
});

describe("resolveModel", () => {
  it("passes a real tag straight through", () => {
    const id = modelIdForTag("gpt-oss:20b");
    const resolved = resolveModel("gpt-oss:20b", id);
    expect(resolved).toMatchObject({ label: "gpt-oss:20b", tag: "gpt-oss:20b", known: true, id });
    expect(resolved.entry).toBe(requireEntry("gpt-oss:20b"));
  });

  it("recovers the tag when the indexer echoes the id back as the name", () => {
    // The live testnet bug: most registrations carry no name, so the subgraph
    // returns name === id verbatim. Inverting the known set is what keeps the UI
    // from printing a hash and modelRequirement() from guessing "8GB / Standard".
    for (const { tag, id } of GROUND_TRUTH) {
      const resolved = resolveModel(id, id);
      expect(resolved.known).toBe(true);
      expect(resolved.tag).toBe(tag);
      expect(resolved.label).toBe(tag);
      expect(resolved.id).toBe(id);
      expect(resolved.entry).toBe(ENTRY_BY_ID.get(id));
    }
  });

  it("recovers the tag from a bare digest even with no id alongside it", () => {
    // Some call sites only have the name column. A name that is itself a digest
    // must still be treated as an id, never as a tag.
    const id = modelIdForTag("qwen3-vl:30b");
    expect(resolveModel(id)).toMatchObject({ label: "qwen3-vl:30b", tag: "qwen3-vl:30b", known: true, id });
  });

  it("normalises an upper-cased id back to the lowercase map key", () => {
    const id = modelIdForTag("glm-4.7-flash");
    const shouted = `0x${id.slice(2).toUpperCase()}`;
    const resolved = resolveModel(shouted, shouted);
    expect(resolved.tag).toBe("glm-4.7-flash");
    expect(resolved.id).toBe(id);
  });

  it("refuses to guess for an id outside the catalog", () => {
    // A model whitelisted after this catalog was written. keccak is one-way, so
    // we cannot recover its tag - and we must not invent one (it would be pulled
    // and fail) nor surface the bare digest as if it were a name.
    const unknown = modelIdForTag("some-model-registered-after-this-catalog");
    const resolved = resolveModel(unknown, unknown);
    expect(resolved.known).toBe(false);
    expect(resolved.tag).toBeNull();
    expect(resolved.entry).toBeUndefined();
    expect(resolved.id).toBe(unknown);
    // The label is a short, human-prefixed placeholder - not the 66-char hash.
    expect(resolved.label).toMatch(/^unnamed 0x[0-9a-f]{8}…$/);
    expect(resolved.label).not.toBe(unknown);
    expect(resolved.label.length).toBeLessThan(unknown.length);
    // ...but still traceable: the prefix it shows is the real id's prefix.
    expect(unknown.startsWith(resolved.label.slice("unnamed ".length, -1))).toBe(true);
  });

  it("treats an unrecognised but real tag as servable, just uncatalogued", () => {
    // `known` means "this is a tag we can serve", not "this is in our catalog".
    // A newly registered model with a proper name is pullable; we simply have no
    // measured size for it, so `entry` stays undefined and callers fall back.
    const resolved = resolveModel("mistral-next:12b", modelIdForTag("mistral-next:12b"));
    expect(resolved.known).toBe(true);
    expect(resolved.tag).toBe("mistral-next:12b");
    expect(resolved.entry).toBeUndefined();
  });

  it("degrades rather than throws on an empty name", () => {
    // A registration with neither name nor id is unusable, but it must not take
    // the models page down - it just resolves to "not known".
    const resolved = resolveModel("");
    expect(resolved.known).toBe(false);
    expect(resolved.tag).toBeNull();
  });

  it("never returns a bare digest as a servable tag, even when name and id disagree", () => {
    // Regression pin. `nameIsId` used to also require `name === id`, so a row
    // whose two fields were different digests fell through to the real-tag path
    // and came back as { tag: <66-char hash>, known: true } - a raw hash marked
    // servable, which would reach `ollama pull` and be hashed a second time into
    // a bogus model id. The shape of the string alone must decide.
    const nameDigest = modelIdForTag("llama3-8b");
    const idDigest = modelIdForTag("gpt-oss:20b");
    const resolved = resolveModel(nameDigest, idDigest);
    expect(resolved.tag).not.toBe(nameDigest);
    // `id` is the authoritative identity, so it is what we invert against.
    expect(resolved.tag).toBe("gpt-oss:20b");
    expect(resolved.id).toBe(idDigest);
  });

  it("flags a digest-vs-digest row as unknown when the id is not in the catalog", () => {
    // Same shape as above, but neither digest resolves. The must-not-happen
    // outcome is `known: true` with a hash in `tag`.
    const nameDigest = modelIdForTag("llama3-8b");
    const idDigest = modelIdForTag("some-model-registered-after-this-catalog");
    const resolved = resolveModel(nameDigest, idDigest);
    expect(resolved.known).toBe(false);
    expect(resolved.tag).toBeNull();
    expect(resolved.label).toMatch(/^unnamed 0x[0-9a-f]{8}…$/);
  });
});

describe("residentVramGb", () => {
  it("prefers the measured peak over any estimate", () => {
    // Measured peaks can sit well BELOW the download - gpt-oss ships MXFP4 and
    // the qwen3-vl vision towers do not stay resident - so estimating anyway
    // would over-reserve and wrongly disqualify machines that fit fine.
    const gptOss20b = requireEntry("gpt-oss:20b");
    expect(residentVramGb(gptOss20b)).toBe(12.7);
    expect(residentVramGb(gptOss20b)).toBeLessThan(gptOss20b.downloadGb);

    for (const entry of MODEL_CATALOG) {
      if (entry.peakVramGb == null) continue;
      expect(residentVramGb(entry)).toBe(entry.peakVramGb);
    }
  });

  it("estimates conservatively when nothing was measured", () => {
    for (const entry of MODEL_CATALOG) {
      if (entry.peakVramGb != null) continue;
      const resident = residentVramGb(entry);
      // Weights alone are never enough: KV cache, context and runtime overhead
      // all live in VRAM too, so an estimate must exceed the download.
      expect(resident).toBeGreaterThan(entry.downloadGb);
      // One decimal, so the UI does not imply precision we do not have.
      expect(Math.abs(resident * 10 - Math.round(resident * 10))).toBeLessThan(1e-9);
    }
    // The exact estimates today, pinned so a change to the overhead formula is a
    // deliberate edit rather than a silent shift in who passes the fit check.
    expect(residentVramGb(requireEntry("llama3-8b"))).toBe(6.1);
    expect(residentVramGb(requireEntry("llama3-70b"))).toBe(46.7);
    expect(residentVramGb(requireEntry("qwen3-coder-next"))).toBe(60.2);
  });
});

describe("lookupModel", () => {
  it("takes a tag or an id, whichever the caller happens to hold", () => {
    const entry = requireEntry("qwen3-embedding:0.6b");
    expect(lookupModel("qwen3-embedding:0.6b")).toBe(entry);
    expect(lookupModel(modelIdForTag("qwen3-embedding:0.6b"))).toBe(entry);
  });

  it("normalises the caller's whitespace and casing", () => {
    const entry = requireEntry("llama3-8b");
    const id = modelIdForTag("llama3-8b");
    expect(lookupModel("  llama3-8b  ")).toBe(entry);
    expect(lookupModel("LLAMA3-8B")).toBe(entry);
    expect(lookupModel(` 0x${id.slice(2).toUpperCase()}\n`)).toBe(entry);
  });

  it("returns undefined rather than a guess for anything unknown", () => {
    expect(lookupModel("not-a-real-model")).toBeUndefined();
    expect(lookupModel(modelIdForTag("not-a-real-model"))).toBeUndefined();
  });
});

describe("catalog facts", () => {
  it("keeps the measured download sizes", () => {
    // Pinned because the tag string cannot imply a footprint: "gemma4:e2b" is
    // 7.2GB despite the "2b", and MoE models decouple params from size entirely.
    for (const { tag, downloadGb } of GROUND_TRUTH) {
      expect(requireEntry(tag).downloadGb).toBe(downloadGb);
    }
  });

  it("marks exactly one entry as an embedding model", () => {
    // Embedders cap max_output_tokens at 1 - routing chat work to one returns
    // vectors, not text - so this flag is what keeps them out of the chat picker.
    expect(MODEL_CATALOG.filter((e) => e.embedding).map((e) => e.tag)).toEqual(["qwen3-embedding:0.6b"]);
  });

  it("is ordered smallest download first", () => {
    // The UI renders the catalog in array order, and ascending size is what makes
    // "what can my machine actually run" scannable.
    const sizes = MODEL_CATALOG.map((e) => e.downloadGb);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });

  it("never records a non-positive size", () => {
    for (const entry of MODEL_CATALOG) {
      expect(entry.downloadGb).toBeGreaterThan(0);
      if (entry.peakVramGb != null) expect(entry.peakVramGb).toBeGreaterThan(0);
    }
  });
});

describe("resolveModel is idempotent", () => {
  // Resolution happens TWICE on the same row: lib/subgraph resolves what the
  // indexer sent and stores the result, then the picker resolves that stored
  // value again. So resolve(resolve(x)) must equal resolve(x). A shape-only
  // check fails here - the placeholder "unnamed 0x1234abcd…" is not a digest,
  // so the second pass would accept it as a genuine tag and hand back
  // known:true, letting a model nobody can serve be selected and staked for.
  const unknownId = modelIdForTag("a-model-that-was-never-published");

  it("keeps an unrecoverable model unrecoverable on re-resolution", () => {
    const first = resolveModel(unknownId, unknownId);
    expect(first.known).toBe(false);
    expect(first.tag).toBeNull();

    const second = resolveModel(first.label, unknownId);
    expect(second.known).toBe(false);
    expect(second.tag).toBeNull();
    expect(second.label).toBe(first.label);
  });

  it("never reports a placeholder as a servable tag", () => {
    const placeholder = resolveModel(unknownId, unknownId).label;
    // The placeholder must not survive as something that could reach
    // `ollama pull` or be hashed a second time into an id nothing answers.
    expect(resolveModel(placeholder, unknownId).tag).toBeNull();
  });

  it("re-resolving a recovered tag is stable", () => {
    const id = modelIdForTag("gpt-oss:20b");
    const first = resolveModel(id, id);
    expect(first.tag).toBe("gpt-oss:20b");
    const second = resolveModel(first.label, id);
    expect(second).toEqual(first);
  });

  it("accepts a correctly-registered tag we have never seen", () => {
    // Future models must still work: the name is proven by hashing it, not by
    // being present in our catalog.
    const tag = "some-future-model:4b";
    const id = modelIdForTag(tag);
    const r = resolveModel(tag, id);
    expect(r.known).toBe(true);
    expect(r.tag).toBe(tag);
    expect(r.entry).toBeUndefined(); // known-good, but no measured sizes
  });

  it("rejects a name that does not hash to the id it came with", () => {
    // Mismatched columns are corrupt data, not a tag - trusting the name here
    // would register the worker for an id the registry never issued.
    const r = resolveModel("llama3-8b", modelIdForTag("gpt-oss:20b"));
    expect(r.tag).toBe("gpt-oss:20b"); // the id wins, and it is in the catalog
  });
});
