import { describe, it, expect, vi, afterEach } from "vitest";
import {
  siweChallenge,
  siweVerify,
  siweSignIn,
  type SiweWalletClient,
} from "../../sdk/src/auth";

const ADDR = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const SIG = "0xabc123" as `0x${string}`;

// Node test env has no window/document, so auth.ts routes straight to
// cfg.consumerApi (the direct host) rather than the browser proxy.
const TESTNET_CONSUMER_API = "https://chat-api.testnet.lightchain.ai";

// A SIWE message string carrying an Expiration Time the helper parses into
// a unix-ms timestamp.
const EXPIRY_ISO = "2031-01-01T00:00:00.000Z";
const SIWE_MESSAGE = [
  "lightchain.ai wants you to sign in with your Ethereum account:",
  ADDR,
  "",
  "Sign in.",
  "",
  "Nonce: abc123",
  `Expiration Time: ${EXPIRY_ISO}`,
].join("\n");

type MockRes = { status: number; body?: unknown };

// Captures url + init for each fetch and replays a queued sequence of
// responses. The body comes back via res.text() (auth.ts always reads text
// first, then JSON.parses it).
function captureFetch(seq: MockRes[]) {
  const calls: Array<{ url: string; init?: { method?: string; body?: string } }> = [];
  const fn = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, init });
    const r = seq[Math.min(calls.length - 1, seq.length - 1)];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? "")),
    } as unknown as Response;
  };
  return Object.assign(fn, { calls });
}

// A wallet whose signMessage records the message it was asked to sign.
function makeWallet(opts: { withAccount?: boolean } = {}): SiweWalletClient & {
  signed: { message?: string; account?: unknown };
} {
  const signed: { message?: string; account?: unknown } = {};
  const wallet: SiweWalletClient & { signed: typeof signed } = {
    signed,
    ...(opts.withAccount === false ? {} : { account: { address: ADDR } }),
    async signMessage(args) {
      signed.message = args.message;
      signed.account = args.account;
      return SIG;
    },
  };
  return wallet;
}

afterEach(() => vi.unstubAllGlobals());

describe("siweChallenge", () => {
  it("GETs the challenge endpoint and returns { nonce, message }", async () => {
    const f = captureFetch([{ status: 200, body: { nonce: "abc123", message: SIWE_MESSAGE } }]);
    vi.stubGlobal("fetch", f);

    const out = await siweChallenge("testnet", ADDR);

    expect(out.nonce).toBe("abc123");
    expect(out.message).toBe(SIWE_MESSAGE);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe(`${TESTNET_CONSUMER_API}/api/auth/challenge?address=${ADDR}`);
    expect(f.calls[0].init?.method).toBe("GET");
  });

  it("routes through a baseUrl override (trailing slash trimmed)", async () => {
    const f = captureFetch([{ status: 200, body: { nonce: "n", message: "m" } }]);
    vi.stubGlobal("fetch", f);

    await siweChallenge("testnet", ADDR, { baseUrl: "https://proxy.example/gw/" });

    expect(f.calls[0].url).toBe(`https://proxy.example/gw/api/auth/challenge?address=${ADDR}`);
  });

  it("surfaces a non-2xx challenge as a clear error including status and body", async () => {
    const f = captureFetch([{ status: 400, body: "bad address" }]);
    vi.stubGlobal("fetch", f);

    await expect(siweChallenge("testnet", ADDR)).rejects.toThrow(/siwe .*: 400 bad address/);
  });
});

describe("siweVerify", () => {
  it("POSTs { message, signature } and returns the verify result", async () => {
    const verifyBody = {
      success: true,
      address: ADDR,
      token: "jwt.token.value",
      user: { id: "u1", walletAddress: ADDR, type: "wallet" },
    };
    const f = captureFetch([{ status: 200, body: verifyBody }]);
    vi.stubGlobal("fetch", f);

    const out = await siweVerify("testnet", { message: SIWE_MESSAGE, signature: SIG });

    expect(out.success).toBe(true);
    expect(out.token).toBe("jwt.token.value");
    expect(out.address).toBe(ADDR);
    expect(f.calls[0].url).toBe(`${TESTNET_CONSUMER_API}/api/auth/verify`);
    expect(f.calls[0].init?.method).toBe("POST");
    expect(JSON.parse(f.calls[0].init!.body!)).toEqual({ message: SIWE_MESSAGE, signature: SIG });
  });

  it("throws a clear error when the gateway returns success=false", async () => {
    const f = captureFetch([{ status: 200, body: { success: false, address: ADDR, token: "x" } }]);
    vi.stubGlobal("fetch", f);

    await expect(siweVerify("testnet", { message: SIWE_MESSAGE, signature: SIG })).rejects.toThrow(
      /success=false or missing token/,
    );
  });

  it("throws a clear error when token is missing even if success=true", async () => {
    const f = captureFetch([{ status: 200, body: { success: true, address: ADDR, token: "" } }]);
    vi.stubGlobal("fetch", f);

    await expect(siweVerify("testnet", { message: SIWE_MESSAGE, signature: SIG })).rejects.toThrow(
      /success=false or missing token/,
    );
  });

  it("surfaces a non-2xx verify HTTP failure with its status", async () => {
    const f = captureFetch([{ status: 401, body: "unauthorized" }]);
    vi.stubGlobal("fetch", f);

    await expect(siweVerify("testnet", { message: SIWE_MESSAGE, signature: SIG })).rejects.toThrow(
      /siwe .*\/api\/auth\/verify: 401 unauthorized/,
    );
  });
});

describe("siweSignIn", () => {
  it("challenges, signs the returned message verbatim, verifies, and returns the session", async () => {
    const f = captureFetch([
      { status: 200, body: { nonce: "abc123", message: SIWE_MESSAGE } }, // challenge
      { status: 200, body: { success: true, address: ADDR, token: "jwt-from-verify" } }, // verify
    ]);
    vi.stubGlobal("fetch", f);
    const wallet = makeWallet();

    const session = await siweSignIn(wallet, "testnet");

    // Signed the exact message the challenge returned.
    expect(wallet.signed.message).toBe(SIWE_MESSAGE);
    // Local-account wallets sign with the full account object (off-RPC).
    expect(wallet.signed.account).toEqual({ address: ADDR });

    // Two HTTP calls: challenge then verify, with the signature from the wallet.
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].url).toContain("/api/auth/challenge");
    expect(f.calls[1].url).toContain("/api/auth/verify");
    expect(JSON.parse(f.calls[1].init!.body!)).toEqual({ message: SIWE_MESSAGE, signature: SIG });

    // Returned session shape.
    expect(session.token).toBe("jwt-from-verify");
    expect(session.address).toBe(ADDR);
    expect(session.network).toBe("testnet");
    expect(session.expiresAt).toBe(Date.parse(EXPIRY_ISO));
    expect(typeof session.bearer).toBe("function");
    expect(session.bearer()).toBe("jwt-from-verify");
  });

  it("falls back to the address when the wallet has no account, signing with the bare address", async () => {
    const f = captureFetch([
      { status: 200, body: { nonce: "n", message: SIWE_MESSAGE } },
      { status: 200, body: { success: true, address: ADDR, token: "tok2" } },
    ]);
    vi.stubGlobal("fetch", f);
    const wallet = makeWallet({ withAccount: false });

    const session = await siweSignIn(wallet, "testnet", { address: ADDR });

    // No account object -> viem dispatches over the bare address.
    expect(wallet.signed.account).toBe(ADDR);
    expect(session.token).toBe("tok2");
    expect(f.calls[0].url).toContain(`address=${ADDR}`);
  });

  it("throws before any network call when no address can be resolved", async () => {
    const f = captureFetch([]);
    vi.stubGlobal("fetch", f);
    const wallet = makeWallet({ withAccount: false });

    await expect(siweSignIn(wallet, "testnet")).rejects.toThrow(/has no account; pass `address`/);
    expect(f.calls).toHaveLength(0);
  });

  it("propagates a verify failure as a clear error (does not return a session)", async () => {
    const f = captureFetch([
      { status: 200, body: { nonce: "n", message: SIWE_MESSAGE } },
      { status: 200, body: { success: false } }, // verify rejects the signature
    ]);
    vi.stubGlobal("fetch", f);
    const wallet = makeWallet();

    await expect(siweSignIn(wallet, "testnet")).rejects.toThrow(/success=false or missing token/);
  });

  it("returns expiresAt=null when the SIWE message has no Expiration Time", async () => {
    const noExpiryMessage = "lightchain.ai wants you to sign in\nNonce: zzz";
    const f = captureFetch([
      { status: 200, body: { nonce: "zzz", message: noExpiryMessage } },
      { status: 200, body: { success: true, address: ADDR, token: "tok3" } },
    ]);
    vi.stubGlobal("fetch", f);

    const session = await siweSignIn(makeWallet(), "testnet");

    expect(session.expiresAt).toBeNull();
  });

  it("rejects an unknown network before any fetch", async () => {
    const f = captureFetch([]);
    vi.stubGlobal("fetch", f);

    await expect(
      siweSignIn(makeWallet(), "nope" as unknown as "testnet"),
    ).rejects.toThrow(/unknown network "nope"/);
    expect(f.calls).toHaveLength(0);
  });
});
