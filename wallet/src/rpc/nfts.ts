/**
 * NFT support without an indexer: the user imports by contract + tokenId (the
 * self-contained equivalent of MetaMask's Import NFT), we verify ownership
 * on-chain, read tokenURI/uri metadata, and build transfer calldata for sends.
 */
import { encodeFunctionData, parseAbi, type PublicClient } from "viem";

export const ERC721_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function name() view returns (string)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
]);
export const ERC1155_ABI = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function uri(uint256 id) view returns (string)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
]);

const IFACE_721 = "0x80ac58cd";
const IFACE_1155 = "0xd9b67a26";
const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

export type NftStandard = "erc721" | "erc1155";

export interface NftItem {
  address: `0x${string}`;
  tokenId: string;
  standard: NftStandard;
  name: string;
  collection: string;
  image: string | null;
}

/** ipfs:// and ERC-1155 {id} templates -> a fetchable https URL. */
export function resolveUri(uri: string, tokenId: string): string {
  const id64 = BigInt(tokenId).toString(16).padStart(64, "0");
  const filled = uri.replace(/\{id\}/g, id64);
  if (filled.startsWith("ipfs://")) return IPFS_GATEWAY + filled.slice(7).replace(/^ipfs\//, "");
  return filled;
}

/** Only https (and inline data:image/) may reach an <img src> in the popup. */
export function safeImageUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^data:image\//.test(url)) return url.length <= 262144 ? url : null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Pull a display name + image out of whatever shape the metadata JSON has. */
export function pickMeta(json: unknown, tokenId: string): { name: string; image: string | null } {
  const m = (json ?? {}) as { name?: unknown; image?: unknown; image_url?: unknown };
  // Clamp the name: it is attacker-controlled metadata and ends up in list rows and sheet titles.
  const name = typeof m.name === "string" && m.name.trim() ? m.name.trim().slice(0, 48) : `#${tokenId}`;
  const rawImage = typeof m.image === "string" ? m.image : typeof m.image_url === "string" ? m.image_url : null;
  return { name, image: safeImageUrl(rawImage ? resolveUri(rawImage, tokenId) : null) };
}

/** Decode data:application/json;base64 (and plain data:application/json) URIs. */
export function decodeDataUri(uri: string): unknown | null {
  if (!uri.startsWith("data:application/json")) return null;
  try {
    const body = uri.slice(uri.indexOf(",") + 1);
    const text = uri.includes(";base64") ? atob(body) : decodeURIComponent(body);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const META_MAX_BYTES = 262144; // 256 KB is generous for NFT JSON
const META_TIMEOUT_MS = 10000;

/** Read at most `cap` bytes; a hostile metadata server must not OOM the worker. */
async function readCapped(res: Response, cap: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      throw new Error("metadata too large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function fetchMetadata(uri: string, tokenId: string): Promise<{ name: string; image: string | null }> {
  const inline = decodeDataUri(uri);
  if (inline) return pickMeta(inline, tokenId);
  try {
    // The URI comes from an arbitrary contract: https only (no http/localhost/
    // intranet probing from the extension), bounded time, bounded body.
    const url = new URL(resolveUri(uri, tokenId));
    if (url.protocol !== "https:") throw new Error("non-https metadata");
    const res = await fetch(url, { signal: AbortSignal.timeout(META_TIMEOUT_MS) });
    return pickMeta(JSON.parse(await readCapped(res, META_MAX_BYTES)), tokenId);
  } catch {
    return { name: `#${tokenId}`, image: null }; // metadata is best-effort; ownership is what matters
  }
}

/**
 * Verify the account owns the token, detect the standard, and read metadata.
 * Throws a human message when the token is not owned or not an NFT contract.
 */
export async function importNft(client: PublicClient, owner: `0x${string}`, address: `0x${string}`, tokenId: string): Promise<NftItem> {
  const id = BigInt(tokenId);
  const is721 = await client.readContract({ address, abi: ERC721_ABI, functionName: "supportsInterface", args: [IFACE_721] }).catch(() => false);
  if (is721) {
    const holder = (await client.readContract({ address, abi: ERC721_ABI, functionName: "ownerOf", args: [id] })) as string;
    if (holder.toLowerCase() !== owner.toLowerCase()) throw new Error("This account does not own that NFT.");
    const uri = (await client.readContract({ address, abi: ERC721_ABI, functionName: "tokenURI", args: [id] }).catch(() => "")) as string;
    const collection = (await client.readContract({ address, abi: ERC721_ABI, functionName: "name" }).catch(() => "")) as string;
    const meta = uri ? await fetchMetadata(uri, tokenId) : { name: `#${tokenId}`, image: null };
    return { address, tokenId, standard: "erc721", collection, ...meta };
  }
  const is1155 = await client.readContract({ address, abi: ERC721_ABI, functionName: "supportsInterface", args: [IFACE_1155] }).catch(() => false);
  if (!is1155) throw new Error("That contract is not an ERC-721 or ERC-1155 NFT.");
  const bal = (await client.readContract({ address, abi: ERC1155_ABI, functionName: "balanceOf", args: [owner, id] })) as bigint;
  if (bal === 0n) throw new Error("This account does not own that NFT.");
  const uri = (await client.readContract({ address, abi: ERC1155_ABI, functionName: "uri", args: [id] }).catch(() => "")) as string;
  const meta = uri ? await fetchMetadata(uri, tokenId) : { name: `#${tokenId}`, image: null };
  return { address, tokenId, standard: "erc1155", collection: "", ...meta };
}

/** Re-check ownership of a stored NFT (prune ones that were sold/transferred). */
export async function stillOwned(client: PublicClient, owner: `0x${string}`, nft: NftItem): Promise<boolean> {
  try {
    if (nft.standard === "erc721") {
      const holder = (await client.readContract({ address: nft.address, abi: ERC721_ABI, functionName: "ownerOf", args: [BigInt(nft.tokenId)] })) as string;
      return holder.toLowerCase() === owner.toLowerCase();
    }
    const bal = (await client.readContract({ address: nft.address, abi: ERC1155_ABI, functionName: "balanceOf", args: [owner, BigInt(nft.tokenId)] })) as bigint;
    return bal > 0n;
  } catch {
    return true; // RPC hiccup: keep it rather than silently dropping
  }
}

export function nftTransferData(standard: NftStandard, from: string, to: string, tokenId: string): `0x${string}` {
  if (standard === "erc721") {
    return encodeFunctionData({ abi: ERC721_ABI, functionName: "safeTransferFrom", args: [from as `0x${string}`, to as `0x${string}`, BigInt(tokenId)] });
  }
  return encodeFunctionData({ abi: ERC1155_ABI, functionName: "safeTransferFrom", args: [from as `0x${string}`, to as `0x${string}`, BigInt(tokenId), 1n, "0x"] });
}
