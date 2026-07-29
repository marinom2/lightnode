import { describe, it, expect } from "vitest";
import { NETWORKS as APP } from "@/lib/network";
import { NETWORKS as SDK, WORKER_REGISTRY, REGISTRY_TOPICS } from "../../sdk/src/index";
import { MODEL_CATALOG, modelIdForTag, resolveModel } from "@/lib/model-catalog";
import { KNOWN_MODEL_TAGS, recoverModelTag, unnamedLabel } from "../../sdk/src/subgraph";

// The SDK mirrors the app's verified network config (rather than the app importing
// the SDK, which would add build coupling). This guard fails the build if they drift,
// giving us the anti-drift benefit without the refactor risk.
describe("lightnode-sdk stays in sync with the app's verified config", () => {
  for (const net of ["mainnet", "testnet"] as const) {
    it(`${net}: chainId / registry / jobRegistry / aiConfig / endpoints / min stake match`, () => {
      expect(SDK[net].chainId).toBe(APP[net].chainId);
      expect(SDK[net].workerRegistry.toLowerCase()).toBe(APP[net].workerRegistry.toLowerCase());
      expect(SDK[net].jobRegistry.toLowerCase()).toBe(APP[net].jobRegistry.toLowerCase());
      expect(SDK[net].aiConfig.toLowerCase()).toBe(APP[net].aiConfig.toLowerCase());
      expect(SDK[net].rpc).toBe(APP[net].rpc);
      expect(SDK[net].subgraph).toBe(APP[net].subgraph);
      expect(SDK[net].workerGateway).toBe(APP[net].workerGateway);
      expect(SDK[net].minStakeLcai).toBe(APP[net].minStakeLcai);
    });
  }

  it("exports the registry predeploy + well-formed event topics", () => {
    expect(WORKER_REGISTRY.toLowerCase()).toBe(APP.mainnet.workerRegistry.toLowerCase());
    expect(REGISTRY_TOPICS.registered).toMatch(/^0x[0-9a-f]{64}$/);
    expect(REGISTRY_TOPICS.exited).toMatch(/^0x[0-9a-f]{64}$/);
  });

  /*
   * The SDK carries its own copy of the model tags because it publishes to npm
   * standalone: it compiles with rootDir "src" and ships only dist/, so a
   * `../lib/model-catalog` import would be outside the program and absent from
   * the tarball. The copy is tags-only (the SDK never sizes a model).
   *
   * Duplication is a deliberate packaging tradeoff, so it needs a guard: adding
   * a model to lib/model-catalog.ts and forgetting the SDK list means the SDK
   * silently stops recovering that model's name and hands callers an "unnamed
   * 0x…" placeholder instead of a tag. Order matters too - both lists are
   * hashed into id->tag maps, and a diff here is far easier to read than a
   * mismatched digest later.
   */
  it("SDK KNOWN_MODEL_TAGS has not drifted from lib/model-catalog.ts", () => {
    expect(KNOWN_MODEL_TAGS).toEqual(MODEL_CATALOG.map((e) => e.tag));
  });

  /*
   * ...and matching DATA is not enough. Two copies of the same decision can hold
   * identical tables and still return different verdicts, which is precisely what
   * had happened: lib's `resolveModel` gained a keccak preimage proof (a claimed
   * name is trusted only when keccak256(name) === id) while the SDK's
   * `recoverModelTag` kept the old shape-only test, so it was NOT idempotent -
   * re-resolving its own "unnamed 0x1234abcd…" placeholder handed it back as a
   * real, servable tag. Callers hash a tag into a model id, so that mints a
   * second, bogus id.
   *
   * So the guard is on the VERDICT, over the cases where the two could disagree.
   * `known === (tag !== null)` and the label are asserted together because both
   * cross the boundary: one decides whether a caller may hash the string, the
   * other is what a user reads.
   */
  describe("SDK recoverModelTag decides identically to lib resolveModel", () => {
    const REAL = "gpt-oss:20b";
    const REAL_ID = modelIdForTag(REAL);
    // A digest with no preimage in either catalog.
    const GHOST = "0x" + "1f".repeat(32);
    const cases: { why: string; name: string; id: string }[] = [
      { why: "indexer echoed the id back as the name", name: REAL_ID, id: REAL_ID },
      { why: "indexer supplied the genuine tag", name: REAL, id: REAL_ID },
      { why: "genuine tag for a model neither catalog knows", name: "brand-new:1b", id: modelIdForTag("brand-new:1b") },
      { why: "uncatalogued id, no name", name: "", id: GHOST },
      { why: "uncatalogued id echoed as the name", name: GHOST, id: GHOST },
      // The idempotence case: feed a previous pass's own output back in.
      { why: "our own placeholder, re-resolved", name: unnamedLabel(GHOST), id: GHOST },
      { why: "our own id-less placeholder, re-resolved", name: unnamedLabel(""), id: "" },
      // Columns that disagree: `name` does not hash to `id`, so the id wins.
      { why: "name and id disagree, id is catalogued", name: "llama3-70b", id: REAL_ID },
      { why: "name and id disagree, id is not catalogued", name: "llama3-70b", id: GHOST },
      // No usable id to check against - a non-digest name is all we have.
      { why: "name only, no id", name: REAL, id: "" },
      { why: "name only, id is not a digest", name: REAL, id: "0xAAAA" },
      { why: "nothing usable at all", name: "", id: "" },
    ];
    for (const c of cases) {
      it(c.why, () => {
        const app = resolveModel(c.name, c.id);
        const tag = recoverModelTag(c.name, c.id);
        expect(tag).toBe(app.tag);
        expect(tag !== null).toBe(app.known);
        expect(tag ?? unnamedLabel(c.id)).toBe(app.label);
      });
    }
  });
});
