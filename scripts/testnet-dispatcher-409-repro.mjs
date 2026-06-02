#!/usr/bin/env node
/**
 * Minimal reproducer for the LightChain testnet dispatcher 409 selection_mismatch
 * bug. Run with: node scripts/testnet-dispatcher-409-repro.mjs
 *
 * Observed behaviour (2026-06-02):
 *   - GENERATE a brand-new private key (never used, no state anywhere).
 *   - SIWE sign-in succeeds (chat-api.testnet.lightchain.ai/api/auth/verify
 *     mints a JWT).
 *   - selectSession succeeds (chat-api.testnet.lightchain.ai/api/sessions/select
 *     returns a worker, encryption keys, nonce, expiry).
 *     Notably, the response does NOT include a `selectionId` field.
 *   - prepareSession IMMEDIATELY returns 409 with:
 *       {"error":"selection_mismatch","message":"selection was superseded;
 *        re-run POST /api/sessions/select"}
 *     There is no concurrent activity for this wallet (it was generated 1 ms ago).
 *
 *   The SAME flow against mainnet (chat-api.mainnet.lightchain.ai) returns 200
 *   on the first attempt with a valid signed prepareSession. No code differences.
 *
 * Hypothesis: the testnet dispatcher has the Story 16 (web-search epic /
 * lcai-chat-v2 commit 33c70841) pending-slot enforcement enabled, but the
 * selectSession handler never started writing a `selectionId` into the slot OR
 * into the response. Every prepare therefore fails the correlation check.
 */
import { randomBytes } from "node:crypto";
import { p256 } from "@noble/curves/nist";
import { gcm } from "@noble/ciphers/aes";
import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1";

const TESTNET = "https://chat-api.testnet.lightchain.ai";
const MAINNET = "https://chat-api.mainnet.lightchain.ai";

function bytesToHex(b) { return "0x" + Array.from(b).map(x => x.toString(16).padStart(2, "0")).join(""); }
function bytesToBase64(b) { return Buffer.from(b).toString("base64"); }
function utf8(s) { return new TextEncoder().encode(s); }

function modelIdFor(tag) {
  return bytesToHex(keccak_256(utf8(tag)));
}

function privToAddress(priv) {
  const pub = secp256k1.getPublicKey(priv, false).slice(1);
  return "0x" + bytesToHex(keccak_256(pub)).slice(-40);
}

// EIP-191 personal_sign (LightChain RPC has no personal_sign; we sign locally).
function signMessage(priv, msg) {
  const prefix = utf8("\x19Ethereum Signed Message:\n" + msg.length);
  const combined = new Uint8Array(prefix.length + msg.length);
  combined.set(prefix); combined.set(msg, prefix.length);
  const sig = secp256k1.sign(keccak_256(combined), priv, { lowS: true });
  const v = sig.recovery + 27;
  return bytesToHex(sig.toCompactRawBytes()) + v.toString(16).padStart(2, "0");
}

async function siwe(base, priv, address) {
  const cRes = await fetch(`${base}/api/auth/challenge?address=${address}`);
  const { message } = await cRes.json();
  const signature = signMessage(priv, utf8(message));
  const vRes = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  const v = await vRes.json();
  if (!v.token) throw new Error("siwe verify failed: " + JSON.stringify(v).slice(0, 200));
  return v.token;
}

async function runOne(label, base) {
  const priv = randomBytes(32);
  const address = privToAddress(priv);
  console.log(`\n[${label}] address: ${address}`);
  const jwt = await siwe(base, priv, address);
  const id = modelIdFor("llama3-8b");

  const sRes = await fetch(`${base}/api/sessions/select`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ modelId: id }),
  });
  const sel = await sRes.json();
  console.log(`[${label}] select: ${sRes.status} worker=${sel.worker?.slice(0,12)} selectionId=${sel.selectionId ?? "(MISSING)"} keys=[${Object.keys(sel).join(",")}]`);
  if (!sel.worker) return;

  // ECDH-encrypt a random 32-byte session key with the worker pubkey.
  const sessionKey = randomBytes(32);
  const myPriv = p256.utils.randomPrivateKey();
  const myPub = p256.getPublicKey(myPriv, false);
  const workerPub = Buffer.from(sel.workerEncryptionKey, "base64");
  const shared = p256.getSharedSecret(myPriv, workerPub, false).slice(1, 33);
  const iv = randomBytes(12);
  const ct = gcm(shared, iv).encrypt(sessionKey);
  const encWorker = Buffer.concat([myPub, iv, ct]);

  const dispPub = Buffer.from(sel.disputerEncryptionKey, "hex");
  const sharedD = p256.getSharedSecret(myPriv, dispPub, false).slice(1, 33);
  const ivD = randomBytes(12);
  const ctD = gcm(sharedD, ivD).encrypt(sessionKey);
  const encDisp = Buffer.concat([myPub, ivD, ctD]);

  const pRes = await fetch(`${base}/api/sessions/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      modelId: id,
      encWorkerKey: bytesToBase64(encWorker),
      encDisputerKey: bytesToBase64(encDisp),
    }),
  });
  const pBody = await pRes.text();
  console.log(`[${label}] prepare: ${pRes.status} ${pBody.slice(0, 220)}`);
}

await runOne("MAINNET", MAINNET);
await runOne("TESTNET", TESTNET);
