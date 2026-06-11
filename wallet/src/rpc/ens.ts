/**
 * ENS name resolution for the send flows. Resolution always runs against
 * Ethereum mainnet (where ENS lives), regardless of the selected network; the
 * resolved 0x address is then used on whatever chain the user is sending on.
 */
import { createPublicClient, http } from "viem";
import { normalize } from "viem/ens";
import { chainById } from "./chains";

/** Cheap pre-check so we only hit the resolver for plausible names. */
export const looksLikeEnsName = (s: string): boolean => /^[a-z0-9]([a-z0-9-_.]{1,200})\.eth$/i.test(s.trim());

export async function resolveEnsName(name: string): Promise<string | null> {
  if (!looksLikeEnsName(name)) return null;
  try {
    const pub = createPublicClient({ chain: chainById(1), transport: http() });
    const address = await pub.getEnsAddress({ name: normalize(name.trim()) });
    return address ?? null;
  } catch {
    return null; // unresolvable or resolver unreachable: treat as not-a-name
  }
}
