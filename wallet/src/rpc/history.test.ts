import { describe, it, expect } from "vitest";
import { parseNativeTxs, parseTokenTransfers, mergeHistory, type HistoryItem } from "./history";

const ME = "0x73C0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaEB5e";
const OTHER = "0x1111111111111111111111111111111111111111";
const LOOKALIKE = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"ab".repeat(32)}`;
const HASH2 = `0x${"cd".repeat(32)}`;
const TS = "2026-06-11T10:00:00.000000Z";

const nativeTx = (over: Record<string, unknown> = {}) => ({
  hash: HASH, from: { hash: OTHER }, to: { hash: ME }, value: "1000000000000000000", timestamp: TS, status: "ok", ...over,
});

describe("parseNativeTxs", () => {
  it("maps a received native transfer with the sender as counterparty", () => {
    const [h] = parseNativeTxs({ items: [nativeTx()] }, ME, "LCAI");
    expect(h).toMatchObject({ direction: "in", kind: "native", label: "LCAI", amount: "1", counterparty: OTHER, failed: false });
  });
  it("maps a sent transfer and marks failed status", () => {
    const [h] = parseNativeTxs({ items: [nativeTx({ from: { hash: ME }, to: { hash: OTHER }, status: "error" })] }, ME, "LCAI");
    expect(h).toMatchObject({ direction: "out", counterparty: OTHER, failed: true });
  });
  it("labels own zero-value txs with the decoded method and drops inbound dust", () => {
    const mine = nativeTx({ from: { hash: ME }, to: { hash: OTHER }, value: "0", method: "approve" });
    const spam = nativeTx({ value: "0" });
    const dust = nativeTx({ hash: HASH2, value: "999" }); // 999 wei inbound: poisoning dust
    const out = parseNativeTxs({ items: [mine, spam, dust] }, ME, "LCAI");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "contract", label: "Contract: approve", direction: "out" });
  });
  it("rejects malformed hashes/addresses and junk items", () => {
    const junk = [
      nativeTx({ hash: "0xshort" }),
      nativeTx({ from: { hash: "not-an-address" } }),
      { hash: 5 },
      null,
      nativeTx({ timestamp: "not a date" }),
    ];
    expect(parseNativeTxs({ items: junk as never }, ME, "LCAI")).toEqual([]);
    expect(parseNativeTxs(null, ME, "LCAI")).toEqual([]);
  });
  it("detects self-sends and parses offsetless timestamps as UTC", () => {
    const [h] = parseNativeTxs({ items: [nativeTx({ from: { hash: ME }, to: { hash: ME }, timestamp: "2026-06-11T10:00:00.000000" })] }, ME, "LCAI");
    expect(h!.direction).toBe("self");
    expect(h!.ts).toBe(Date.parse(TS));
  });
});

const transfer = (over: Record<string, unknown> = {}) => ({
  transaction_hash: HASH, from: { hash: OTHER }, to: { hash: ME }, timestamp: TS,
  token: { symbol: "USDC", type: "ERC-20" }, total: { value: "2500000", decimals: "6" }, log_index: 7, ...over,
});

describe("parseTokenTransfers", () => {
  it("maps an ERC-20 receive with decimals and log index", () => {
    const [h] = parseTokenTransfers({ items: [transfer()] }, ME);
    expect(h).toMatchObject({ direction: "in", kind: "token", label: "USDC", amount: "2.5", counterparty: OTHER, logIndex: 7 });
  });
  it("drops zero-value transfers in BOTH directions (poisoning vector)", () => {
    const fakeOut = transfer({ from: { hash: ME }, to: { hash: LOOKALIKE }, total: { value: "0", decimals: "6" } });
    const spamIn = transfer({ total: { value: "0", decimals: "6" } });
    expect(parseTokenTransfers({ items: [fakeOut, spamIn] }, ME)).toEqual([]);
  });
  it("maps ERC-721/1155 as NFT items with token id and no amount", () => {
    const [h] = parseTokenTransfers({ items: [transfer({ token: { name: "Light Genesis", type: "ERC-721" }, total: { token_id: "214" } })] }, ME);
    expect(h).toMatchObject({ kind: "nft", label: "Light Genesis #214", amount: "" });
  });
  it("clamps hostile symbols and strips bidi controls", () => {
    const [h] = parseTokenTransfers({ items: [transfer({ token: { symbol: `‮evil${"X".repeat(60)}`, type: "ERC-20" } })] }, ME);
    expect(h!.label.length).toBeLessThanOrEqual(24);
    expect(h!.label).not.toContain("‮");
  });
});

describe("mergeHistory", () => {
  const item = (over: Partial<HistoryItem>): HistoryItem => ({ hash: HASH, direction: "out", kind: "native", label: "LCAI", amount: "1", counterparty: OTHER, ts: 1, failed: false, ...over });
  it("sorts newest first, dedupes, and caps at 50", () => {
    const dupe = item({ hash: HASH2, ts: 100 });
    const many = Array.from({ length: 80 }, (_, i) => item({ hash: `0x${i.toString(16).padStart(64, "0")}`, ts: i }));
    const out = mergeHistory([dupe], [dupe, ...many]);
    expect(out).toHaveLength(50);
    expect(out[0]!.ts).toBeGreaterThanOrEqual(out[1]!.ts);
    expect(out.filter((h) => h.hash === HASH2)).toHaveLength(1);
  });
  it("keeps same-token same-direction transfers with different log indexes (batch payouts)", () => {
    const a = item({ kind: "token", label: "USDT", amount: "5", logIndex: 1 });
    const b = item({ kind: "token", label: "USDT", amount: "7", logIndex: 2 });
    expect(mergeHistory([a, b])).toHaveLength(2);
  });
  it("suppresses the duplicate contract-call row when the same tx has an asset row", () => {
    const call = item({ kind: "contract", label: "Contract: transfer", amount: "" });
    const tokenRow = item({ kind: "token", label: "USDC", amount: "25", logIndex: 3 });
    const out = mergeHistory([call], [tokenRow]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("token");
  });
});
