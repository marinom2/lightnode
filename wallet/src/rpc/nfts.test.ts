import { describe, it, expect } from "vitest";
import { resolveUri, pickMeta, decodeDataUri, nftTransferData, safeImageUrl } from "./nfts";

describe("safeImageUrl", () => {
  it("allows https and inline data:image, rejects everything else", () => {
    expect(safeImageUrl("https://img.example/x.png")).toBe("https://img.example/x.png");
    expect(safeImageUrl("data:image/png;base64,iVBOR")).toBe("data:image/png;base64,iVBOR");
    expect(safeImageUrl("http://img.example/x.png")).toBeNull();
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("data:text/html,<script>1</script>")).toBeNull();
    expect(safeImageUrl("chrome-extension://abc/x.png")).toBeNull();
    expect(safeImageUrl("not a url")).toBeNull();
    expect(safeImageUrl(null)).toBeNull();
  });
  it("rejects oversized data:image payloads", () => {
    expect(safeImageUrl(`data:image/png;base64,${"A".repeat(300000)}`)).toBeNull();
  });
});

describe("resolveUri", () => {
  it("rewrites ipfs:// to a public gateway", () => {
    expect(resolveUri("ipfs://QmHash/1.json", "1")).toBe("https://ipfs.io/ipfs/QmHash/1.json");
    expect(resolveUri("ipfs://ipfs/QmHash", "1")).toBe("https://ipfs.io/ipfs/QmHash");
  });
  it("substitutes the ERC-1155 {id} template as 64-char lowercase hex", () => {
    expect(resolveUri("https://x.io/{id}.json", "255")).toBe(`https://x.io/${"ff".padStart(64, "0")}.json`);
  });
  it("passes plain https through untouched", () => {
    expect(resolveUri("https://meta.example/1", "1")).toBe("https://meta.example/1");
  });
});

describe("pickMeta", () => {
  it("uses name + image and resolves ipfs images", () => {
    const m = pickMeta({ name: "Cool Cat #7", image: "ipfs://QmImg" }, "7");
    expect(m).toEqual({ name: "Cool Cat #7", image: "https://ipfs.io/ipfs/QmImg" });
  });
  it("falls back to image_url and #tokenId name", () => {
    const m = pickMeta({ image_url: "https://img.example/7.png" }, "7");
    expect(m).toEqual({ name: "#7", image: "https://img.example/7.png" });
  });
  it("handles junk metadata without throwing", () => {
    expect(pickMeta(null, "9")).toEqual({ name: "#9", image: null });
    expect(pickMeta({ name: 42, image: {} }, "9")).toEqual({ name: "#9", image: null });
  });
  it("clamps hostile names and strips unsafe image schemes", () => {
    const m = pickMeta({ name: "x".repeat(200), image: "javascript:alert(1)" }, "9");
    expect(m.name.length).toBe(48);
    expect(m.image).toBeNull();
  });
});

describe("decodeDataUri", () => {
  it("decodes base64 on-chain metadata", () => {
    const json = btoa(JSON.stringify({ name: "OnChain", image: "ipfs://Qx" }));
    expect(decodeDataUri(`data:application/json;base64,${json}`)).toEqual({ name: "OnChain", image: "ipfs://Qx" });
  });
  it("returns null for non-JSON and malformed URIs", () => {
    expect(decodeDataUri("https://x.io/1.json")).toBeNull();
    expect(decodeDataUri("data:application/json;base64,not-base64!!!")).toBeNull();
  });
});

describe("nftTransferData", () => {
  const FROM = "0x1111111111111111111111111111111111111111";
  const TO = "0x2222222222222222222222222222222222222222";
  it("encodes ERC-721 safeTransferFrom(from,to,id)", () => {
    const data = nftTransferData("erc721", FROM, TO, "7");
    expect(data.startsWith("0x42842e0e")).toBe(true); // safeTransferFrom(address,address,uint256)
    expect(data).toContain(FROM.slice(2).toLowerCase());
    expect(data).toContain(TO.slice(2).toLowerCase());
  });
  it("encodes ERC-1155 safeTransferFrom with amount 1", () => {
    const data = nftTransferData("erc1155", FROM, TO, "7");
    expect(data.startsWith("0xf242432a")).toBe(true); // safeTransferFrom(address,address,uint256,uint256,bytes)
  });
});
