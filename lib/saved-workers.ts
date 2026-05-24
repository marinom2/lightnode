"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "lightnode.saved-workers";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Watch-list of worker addresses, persisted to localStorage. */
export function useSavedWorkers() {
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    setSaved(read());
  }, []);

  const persist = useCallback((next: string[]) => {
    setSaved(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const add = useCallback(
    (addr: string) => {
      const a = addr.toLowerCase();
      setSaved((cur) => {
        if (cur.map((x) => x.toLowerCase()).includes(a)) return cur;
        const next = [addr, ...cur].slice(0, 10);
        try {
          window.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [],
  );

  const remove = useCallback(
    (addr: string) => persist(read().filter((x) => x.toLowerCase() !== addr.toLowerCase())),
    [persist],
  );

  const has = useCallback((addr: string) => saved.map((x) => x.toLowerCase()).includes(addr.toLowerCase()), [saved]);

  return { saved, add, remove, has };
}
