import { describe, it, expect } from "vitest";
import { parseTransfers, netChanges, TRANSFER_TOPIC, NATIVE_SENTINEL, type SimLog } from "./simulate";

const USER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const pad = (a: string) => `0x000000000000000000000000${a.slice(2)}`;
const hex = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
const log = (token: string, from: string, to: string, value: bigint): SimLog => ({
  address: token,
  topics: [TRANSFER_TOPIC, pad(from), pad(to)],
  data: hex(value),
});

describe("parseTransfers", () => {
  it("decodes Transfer logs (token, from, to, value)", () => {
    const [t] = parseTransfers([log(TOKEN, USER, OTHER, 500n)]);
    expect(t.token).toBe(TOKEN.toLowerCase());
    expect(t.from).toBe(USER.toLowerCase());
    expect(t.to).toBe(OTHER.toLowerCase());
    expect(t.value).toBe(500n);
  });
  it("ignores non-Transfer logs", () => {
    expect(parseTransfers([{ address: TOKEN, topics: ["0xdead"], data: "0x" }])).toHaveLength(0);
  });
});

describe("netChanges (signer's send/receive)", () => {
  it("nets a native send as a negative native delta", () => {
    const m = netChanges(parseTransfers([log(NATIVE_SENTINEL, USER, OTHER, 10n ** 18n)]), USER);
    expect(m.get(NATIVE_SENTINEL)).toBe(-(10n ** 18n));
  });
  it("captures a swap: send token, receive native", () => {
    const m = netChanges(parseTransfers([log(TOKEN, USER, OTHER, 1000n), log(NATIVE_SENTINEL, OTHER, USER, 5n)]), USER);
    expect(m.get(TOKEN.toLowerCase())).toBe(-1000n);
    expect(m.get(NATIVE_SENTINEL)).toBe(5n);
  });
  it("collapses offsetting in/out to a net and drops a zero net", () => {
    const m = netChanges(parseTransfers([log(TOKEN, USER, OTHER, 100n), log(TOKEN, OTHER, USER, 100n)]), USER);
    expect(m.has(TOKEN.toLowerCase())).toBe(false);
  });
  it("ignores transfers that don't involve the signer", () => {
    expect(netChanges(parseTransfers([log(TOKEN, OTHER, OTHER, 9n)]), USER).size).toBe(0);
  });
});
