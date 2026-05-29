import { describe, it, expect } from "vitest";
import { NETWORKS as APP } from "@/lib/network";
import { NETWORKS as SDK, WORKER_REGISTRY, REGISTRY_TOPICS } from "../../sdk/src/index";

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
});
