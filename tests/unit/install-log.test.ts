import { describe, it, expect } from "vitest";
import { cleanLine, collapseKey, appendCleanLog } from "@/lib/install-log";

const ESC = String.fromCharCode(27); // ASCII escape (0x1B)
// A real ollama "pulling manifest" frame: synchronized-output + hide-cursor +
// cursor-home, the text, a spinner glyph, clear-to-EOL, show-cursor.
const manifestFrame = `${ESC}[?2026h${ESC}[?25l${ESC}[1Gpulling manifest ⠋ ${ESC}[K${ESC}[?25h${ESC}[?2026l`;
const layerFrame = (pct: number, mb: number) =>
  `${ESC}[1Gpulling 4e30e2665218: ${pct}% ▕████      ▏ ${mb} MB/7.2 GB ${ESC}[K`;

describe("cleanLine", () => {
  it("strips ANSI escapes, spinner, and clear-to-EOL", () => {
    expect(cleanLine(manifestFrame)).toBe("pulling manifest");
  });

  it("keeps a readable progress line (bar + size) without the escapes", () => {
    expect(cleanLine(layerFrame(41, 2900))).toBe("pulling 4e30e2665218: 41% ▕████      ▏ 2900 MB/7.2 GB");
  });

  it("resolves carriage returns - the last frame wins", () => {
    expect(cleanLine("pulling manifest\rpulling 4e30e2665218: 5%")).toBe("pulling 4e30e2665218: 5%");
  });

  it("collapses concatenated cursor-home frames to the last one", () => {
    const jammed = `${ESC}[1Gpulling x: 10%${ESC}[1Gpulling x: 11%${ESC}[1Gpulling x: 12%`;
    expect(cleanLine(jammed)).toBe("pulling x: 12%");
  });

  it("returns empty for a control-only frame", () => {
    expect(cleanLine(`${ESC}[?25l${ESC}[?25h`)).toBe("");
  });

  it("passes plain status lines through unchanged", () => {
    expect(cleanLine("✓ Docker engine ready")).toBe("✓ Docker engine ready");
  });
});

describe("collapseKey", () => {
  it("gives the same key to two updates of the same layer", () => {
    expect(collapseKey("pulling 4e30e2665218: 41% ▕███▏ 2.9 GB/7.2 GB")).toBe(
      collapseKey("pulling 4e30e2665218: 88% ▕█████▏ 6.3 GB/7.2 GB"),
    );
  });

  it("gives different keys to different layers", () => {
    expect(collapseKey("pulling 4e30e2665218: 41%")).not.toBe(collapseKey("pulling a1b2c3d4e5f6: 41%"));
  });

  it("returns null for non-progress lines", () => {
    expect(collapseKey("✓ Docker engine ready")).toBeNull();
    expect(collapseKey("▶ phase 07-register")).toBeNull();
  });
});

describe("appendCleanLog", () => {
  it("collapses a flood of progress frames into a single updating line", () => {
    let log: string[] = [];
    log = appendCleanLog(log, "▶ pulling gemma4-e2b (as gemma4:e2b)");
    for (let pct = 0; pct <= 100; pct += 1) {
      log = appendCleanLog(log, layerFrame(pct, pct * 72));
    }
    // The 101 progress frames collapse to one line; the "▶ pulling" header stays.
    expect(log).toHaveLength(2);
    expect(log[0]).toContain("▶ pulling gemma4-e2b");
    expect(log[1]).toContain("100%");
  });

  it("keeps separate lines for the manifest, each layer, and the final status", () => {
    let log: string[] = [];
    for (let i = 0; i < 5; i++) log = appendCleanLog(log, manifestFrame);
    for (let pct = 0; pct <= 100; pct += 20) log = appendCleanLog(log, layerFrame(pct, pct * 72));
    log = appendCleanLog(log, "✓ model gemma4-e2b present");
    expect(log).toEqual(["pulling manifest", expect.stringContaining("100%"), "✓ model gemma4-e2b present"]);
  });

  it("drops control-only frames entirely", () => {
    let log: string[] = [];
    log = appendCleanLog(log, `${ESC}[?25l`);
    log = appendCleanLog(log, `${ESC}[?25h`);
    expect(log).toEqual([]);
  });
});
