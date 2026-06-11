import { describe, it, expect } from "vitest";
import { looksAlike, assessRecipient } from "./risk";

const REAL = "0xAbC1230000000000000000000000000000009876";
// Same first 3 (abc) + last 4 (9876), different middle = classic poisoning lookalike.
const FAKE = "0xAbCfff0000000000000000000000000000009876";
const UNRELATED = "0x1111111111111111111111111111111111111111";
const MINE = "0x2222222222222222222222222222222222222222";

describe("looksAlike (prefix>=3 AND suffix>=4)", () => {
  it("flags a same-prefix/same-suffix different-middle address", () => {
    expect(looksAlike(FAKE, REAL)).toBe(true);
  });
  it("does not flag the identical address", () => {
    expect(looksAlike(REAL, REAL)).toBe(false);
  });
  it("does not flag an unrelated address", () => {
    expect(looksAlike(UNRELATED, REAL)).toBe(false);
  });
  it("requires BOTH prefix>=3 and suffix>=4 (shared prefix only is not enough)", () => {
    const prefixOnly = "0xAbC1111111111111111111111111111111111111";
    expect(looksAlike(prefixOnly, REAL)).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(looksAlike(FAKE.toLowerCase(), REAL.toUpperCase())).toBe(true);
  });
});

describe("assessRecipient", () => {
  it("recognizes your own address as self", () => {
    expect(assessRecipient(MINE, [REAL], [MINE]).kind).toBe("self");
  });
  it("recognizes a previously-used address as known", () => {
    expect(assessRecipient(REAL, [REAL], [MINE]).kind).toBe("known");
  });
  it("flags a lookalike of a known address and names what it imitates", () => {
    const a = assessRecipient(FAKE, [REAL], [MINE]);
    expect(a.kind).toBe("lookalike");
    expect(a.similarTo).toBe(REAL);
  });
  it("flags a lookalike of your OWN address too", () => {
    const fakeMine = "0x2222220000000000000000000000000000002222";
    expect(assessRecipient(fakeMine, [], [MINE]).kind).toBe("lookalike");
  });
  it("treats a brand-new address as new", () => {
    expect(assessRecipient(UNRELATED, [REAL], [MINE]).kind).toBe("new");
  });
});
