/**
 * Chunked base64 for byte arrays. We deliberately avoid `btoa(String.fromCharCode(...u))`
 * because spreading a large Uint8Array overflows the call stack (RangeError) - a real
 * footgun once the same helper touches bigger blobs than a 12-word mnemonic.
 */
const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
