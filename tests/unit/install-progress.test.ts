import { describe, it, expect } from "vitest";
import { deriveInstallView, latestDownloadPercent } from "@/lib/install-progress";

const PREP = [
  "▶ LightNode installer rev x (testnet)",
  "✓ Docker engine ready",
  "✓ Ollama server running",
  "✓ Foundry (cast) ready",
  "✓ workdir: /Users/me/.lightnode",
];

describe("latestDownloadPercent", () => {
  it("reads the most recent pull percentage", () => {
    expect(latestDownloadPercent(["pulling 4e30: 4% ▕▏ 284 MB/7.2 GB", "pulling 4e30: 7% ▕▏ 510 MB/7.2 GB"])).toBe(7);
  });
  it("ignores percentages outside a pull/download context", () => {
    expect(latestDownloadPercent(["staked 100% of the minimum"])).toBeNull();
  });
  it("returns null when nothing is downloading", () => {
    expect(latestDownloadPercent(["✓ Docker engine ready"])).toBeNull();
  });
});

describe("deriveInstallView", () => {
  it("marks the model step active with a download percent mid-pull", () => {
    const v = deriveInstallView([...PREP, "▶ downloading gemma4-e2b", "pulling 4e30: 4% ▕▏ 284 MB/7.2 GB"], "running");
    const prepare = v.milestones.find((m) => m.id === "prepare")!;
    const model = v.milestones.find((m) => m.id === "model")!;
    expect(prepare.status).toBe("done");
    expect(model.status).toBe("active");
    expect(model.detail).toBe("4%");
    expect(v.download).toBe(4);
    expect(v.headline).toContain("4%");
  });

  it("treats every milestone as done when the run finishes", () => {
    const v = deriveInstallView([...PREP, "✅ worker online"], "done");
    expect(v.milestones.every((m) => m.status === "done")).toBe(true);
    expect(v.headline).toMatch(/online/i);
  });

  it("flags the first incomplete step as the error on failure", () => {
    const v = deriveInstallView([...PREP, "▶ downloading gemma4-e2b", "⛔ pull failed"], "failed");
    const model = v.milestones.find((m) => m.id === "model")!;
    expect(model.status).toBe("error");
    // earlier steps stay done, later steps stay pending
    expect(v.milestones.find((m) => m.id === "prepare")!.status).toBe("done");
    expect(v.milestones.find((m) => m.id === "register")!.status).toBe("pending");
  });

  it("advances later milestones when their markers appear even if an earlier marker was skipped", () => {
    // A model that's already present prints no pull markers; register starting
    // still implies prepare + model are done.
    const v = deriveInstallView(["▶ phase 07-register", "registering worker"], "running");
    expect(v.milestones.find((m) => m.id === "prepare")!.status).toBe("done");
    expect(v.milestones.find((m) => m.id === "model")!.status).toBe("done");
    expect(v.milestones.find((m) => m.id === "register")!.status).toBe("active");
  });
});
