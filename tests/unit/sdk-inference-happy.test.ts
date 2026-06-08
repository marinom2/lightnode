import { describe, it, expect } from "vitest";
import {
  prepareSession,
  submitPrompt,
  decryptResponse,
  crypto,
  modelId,
  type SessionPreparation,
} from "../../sdk/src/index";
import type {
  GatewayClient,
  SelectSessionResult,
  PrepareSessionResult,
  UploadBlobResult,
} from "../../sdk/src/gateway";

// A dispatcher-assigned worker / signing address used across the fixtures.
const WORKER = "0x2222222222222222222222222222222222222222" as `0x${string}`;
// A canonical dispatcher EIP-712 signature (initState) the prepare echoes back.
const SIGNATURE = ("0x" + "ab".repeat(65)) as `0x${string}`;
const MODEL_TAG = "llama3-8b";

// Build a fresh worker P-256 keypair with the SDK's OWN crypto so importPublicKey
// accepts it. The gateway hands the worker pubkey to the client as base64.
async function workerPubKeyBase64(): Promise<string> {
  const kp = await crypto.generateEcdhKeyPair();
  return crypto.bytesToBase64(kp.publicKey);
}

// A minimal GatewayClient stub: only the two methods prepareSession() touches
// (selectSession + prepareSession) are implemented. No RPC, no WebSocket.
function mockGateway(
  selected: SelectSessionResult,
  prepared: PrepareSessionResult,
  spy?: { select: number; prepare: number; lastPrepareInput?: unknown },
): GatewayClient {
  return {
    async selectSession() {
      if (spy) spy.select++;
      return selected;
    },
    async prepareSession(input: unknown) {
      if (spy) {
        spy.prepare++;
        spy.lastPrepareInput = input;
      }
      return prepared;
    },
  } as unknown as GatewayClient;
}

describe("prepareSession builds the createSessionArgs from a mocked gateway", () => {
  it("returns the SessionPreparation shape with createSessionArgs in slot order", async () => {
    const workerKey = await workerPubKeyBase64();
    const spy = { select: 0, prepare: 0 } as {
      select: number;
      prepare: number;
      lastPrepareInput?: unknown;
    };
    const gateway = mockGateway(
      { worker: WORKER, workerEncryptionKey: workerKey, nonce: 7, expiry: 1893456000, workerCapabilities: ["search"] },
      { worker: WORKER, signature: SIGNATURE, nonce: 7, expiry: 1893456000 },
      spy,
    );

    const prep: SessionPreparation = await prepareSession(gateway, MODEL_TAG);

    // Both gateway calls happened exactly once (one atomic select -> prepare).
    expect(spy.select).toBe(1);
    expect(spy.prepare).toBe(1);

    // The fresh session key is a 32-byte symmetric key.
    expect(prep.sessionKey).toBeInstanceOf(Uint8Array);
    expect(prep.sessionKey.length).toBe(32);

    // nonce + capabilities are threaded straight from the gateway results.
    expect(prep.nonce).toBe(7);
    expect(prep.workerCapabilities).toEqual(["search"]);

    // createSessionArgs: paramsHash = keccak256(tag); worker + initState + expiry
    // come from prepared; encWorkerKey/ephemeralPubKey are hex-encoded wire bytes.
    const args = prep.createSessionArgs;
    expect(args.paramsHash).toBe(modelId(MODEL_TAG));
    expect(args.worker).toBe(WORKER);
    expect(args.initState).toBe(SIGNATURE);
    expect(args.expiry).toBe(1893456000n);
    // encWorkerKey is the ECDH-wrap of the session key for the worker, hex form:
    // ephemeralPub(65) || nonce(12) || ct || tag(16) = 65 + 12 + 32 + 16 = 125 bytes.
    expect(args.encWorkerKey.startsWith("0x")).toBe(true);
    expect(args.encWorkerKey.length).toBe(2 + 125 * 2);
    // No disputer key was returned, so ephemeralPubKey wraps an empty byte string.
    expect(args.ephemeralPubKey).toBe("0x");
  });

  it("base64-encodes encWorkerKey/encDisputerKey in the gateway.prepareSession call and echoes selectionId", async () => {
    const workerKey = await workerPubKeyBase64();
    const disputerKey = await workerPubKeyBase64();
    const spy = { select: 0, prepare: 0 } as {
      select: number;
      prepare: number;
      lastPrepareInput?: unknown;
    };
    const gateway = mockGateway(
      {
        worker: WORKER,
        workerEncryptionKey: workerKey,
        disputerEncryptionKey: disputerKey,
        nonce: 1,
        expiry: 1893456000,
        selectionId: "sel-123",
      },
      { worker: WORKER, signature: SIGNATURE, nonce: 1, expiry: 1893456000 },
      spy,
    );

    const prep = await prepareSession(gateway, MODEL_TAG);

    const input = spy.lastPrepareInput as {
      modelId: `0x${string}`;
      encWorkerKey: string;
      encDisputerKey: string;
      selectionId?: string;
    };
    // The dispatcher's selectionId is echoed back to bind the prepare to our select.
    expect(input.selectionId).toBe("sel-123");
    expect(input.modelId).toBe(modelId(MODEL_TAG));
    // base64 wire form decodes back to the same byte count as the hex on-chain form.
    const encWorkerBytes = crypto.base64ToBytes(input.encWorkerKey);
    expect(encWorkerBytes.length).toBe(125);
    expect(crypto.bytesToHex(encWorkerBytes)).toBe(prep.createSessionArgs.encWorkerKey);
    // With a disputer key present, ephemeralPubKey is a real 125-byte wrap, not "0x".
    expect(prep.createSessionArgs.ephemeralPubKey.length).toBe(2 + 125 * 2);
    expect(crypto.bytesToHex(crypto.base64ToBytes(input.encDisputerKey))).toBe(
      prep.createSessionArgs.ephemeralPubKey,
    );
  });

  it("defaults workerCapabilities to [] when the gateway omits them", async () => {
    const workerKey = await workerPubKeyBase64();
    const gateway = mockGateway(
      { worker: WORKER, workerEncryptionKey: workerKey, nonce: 0, expiry: 1893456000 },
      { worker: WORKER, signature: SIGNATURE, nonce: 0, expiry: 1893456000 },
    );
    const prep = await prepareSession(gateway, MODEL_TAG);
    expect(prep.workerCapabilities).toEqual([]);
  });
});

describe("crypto round-trip used by the inference submit path", () => {
  // The session-key encrypt + base64 upload that submitPrompt does, then the
  // base64 decrypt that decryptResponse does on the worker's reply, must be a
  // lossless round-trip on the SAME session key.
  it("decryptResponse recovers a prompt encrypted with the SDK's own encrypt (base64)", async () => {
    const sessionKey = await crypto.generateSessionKey();
    const plaintext = "Reply with a one-sentence fun fact about the ocean.";
    const ct = await crypto.encrypt(sessionKey, crypto.utf8ToBytes(plaintext));
    const base64 = crypto.bytesToBase64(ct);

    const recovered = await decryptResponse(sessionKey, base64);
    expect(recovered).toBe(plaintext);
  });

  it("decryptResponse also accepts raw ciphertext bytes (not just base64)", async () => {
    const sessionKey = await crypto.generateSessionKey();
    const plaintext = "unicode ✓ payload — round trips";
    const ct = await crypto.encrypt(sessionKey, crypto.utf8ToBytes(plaintext));

    const recovered = await decryptResponse(sessionKey, ct);
    expect(recovered).toBe(plaintext);
  });

  it("submitPrompt encrypts + uploads and returns the gateway's blob hash; that ciphertext decrypts back", async () => {
    const sessionKey = await crypto.generateSessionKey();
    const prompt = "ping";
    const BLOB_HASH = ("0x" + "cd".repeat(32)) as `0x${string}`;
    let uploaded: string | undefined;

    const gateway = {
      async uploadBlob(base64Data: string): Promise<UploadBlobResult> {
        uploaded = base64Data;
        return { blobHashes: [BLOB_HASH] };
      },
    } as unknown as GatewayClient;

    const hash = await submitPrompt(gateway, sessionKey, prompt);
    expect(hash).toBe(BLOB_HASH);

    // The blob the gateway received is the encrypted prompt: decrypting it with
    // the same session key yields the original plaintext (closes the loop).
    expect(uploaded).toBeDefined();
    const back = await decryptResponse(sessionKey, uploaded as string);
    expect(back).toBe(prompt);
  });

  it("submitPrompt throws when the gateway returns no blob hashes", async () => {
    const sessionKey = await crypto.generateSessionKey();
    const gateway = {
      async uploadBlob(): Promise<UploadBlobResult> {
        return { blobHashes: [] };
      },
    } as unknown as GatewayClient;

    await expect(submitPrompt(gateway, sessionKey, "x")).rejects.toThrow(/no blob hashes/i);
  });

  it("a wrong session key fails the GCM auth tag (does not silently mis-decrypt)", async () => {
    const sessionKey = await crypto.generateSessionKey();
    const otherKey = await crypto.generateSessionKey();
    const ct = await crypto.encrypt(sessionKey, crypto.utf8ToBytes("secret"));
    await expect(decryptResponse(otherKey, crypto.bytesToBase64(ct))).rejects.toThrow();
  });
});
