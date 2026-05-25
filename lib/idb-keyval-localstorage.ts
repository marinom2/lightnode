/**
 * Drop-in replacement for `idb-keyval`, backed by localStorage.
 *
 * WalletConnect/Reown, Coinbase and Base wallet SDKs persist their (tiny)
 * session state through idb-keyval, i.e. IndexedDB. Inside Tauri's WebView
 * (WKWebView / WebKitGTK / WebView2) IndexedDB throws
 * "Failed to execute 'transaction' on 'IDBDatabase': The database connection
 * is closing" mid-flow, breaking wallet connect. localStorage is reliable in
 * those WebViews (and in browsers), and the stored payloads are only a few KB,
 * so we alias `idb-keyval` to this module in next.config.ts.
 *
 * API + signatures mirror idb-keyval so it is a transparent substitute.
 */

/** A store handle is just a namespace string here (no real IndexedDB store). */
export type UseStore = string;

const DEFAULT_STORE: UseStore = "keyval-store:keyval";

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function entryKey(key: IDBValidKey, store?: UseStore): string {
  return `idbkv:${store ?? DEFAULT_STORE}:${String(key)}`;
}

function entryPrefix(store?: UseStore): string {
  return `idbkv:${store ?? DEFAULT_STORE}:`;
}

export function createStore(dbName: string, storeName: string): UseStore {
  return `${dbName}:${storeName}`;
}

export async function get<T = unknown>(key: IDBValidKey, store?: UseStore): Promise<T | undefined> {
  if (!hasLocalStorage()) return undefined;
  const raw = window.localStorage.getItem(entryKey(key, store));
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function set(key: IDBValidKey, value: unknown, store?: UseStore): Promise<void> {
  if (!hasLocalStorage()) return;
  window.localStorage.setItem(entryKey(key, store), JSON.stringify(value));
}

export async function setMany(entriesToSet: [IDBValidKey, unknown][], store?: UseStore): Promise<void> {
  if (!hasLocalStorage()) return;
  for (const [key, value] of entriesToSet) {
    window.localStorage.setItem(entryKey(key, store), JSON.stringify(value));
  }
}

export async function del(key: IDBValidKey, store?: UseStore): Promise<void> {
  if (!hasLocalStorage()) return;
  window.localStorage.removeItem(entryKey(key, store));
}

export async function delMany(keys: IDBValidKey[], store?: UseStore): Promise<void> {
  if (!hasLocalStorage()) return;
  for (const key of keys) window.localStorage.removeItem(entryKey(key, store));
}

function namespacedKeys(store?: UseStore): string[] {
  const prefix = entryPrefix(store);
  const out: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(prefix)) out.push(k);
  }
  return out;
}

export async function clear(store?: UseStore): Promise<void> {
  if (!hasLocalStorage()) return;
  for (const k of namespacedKeys(store)) window.localStorage.removeItem(k);
}

export async function keys<KeyType extends IDBValidKey = IDBValidKey>(store?: UseStore): Promise<KeyType[]> {
  if (!hasLocalStorage()) return [];
  const prefix = entryPrefix(store);
  return namespacedKeys(store).map((k) => k.slice(prefix.length) as unknown as KeyType);
}

export async function getMany<T = unknown>(keysToGet: IDBValidKey[], store?: UseStore): Promise<(T | undefined)[]> {
  return Promise.all(keysToGet.map((key) => get<T>(key, store)));
}

export async function entries<KeyType extends IDBValidKey = IDBValidKey, ValueType = unknown>(
  store?: UseStore,
): Promise<[KeyType, ValueType][]> {
  const allKeys = await keys<KeyType>(store);
  const allValues = await getMany<ValueType>(allKeys, store);
  return allKeys.map((key, i) => [key, allValues[i] as ValueType]);
}

export async function values<T = unknown>(store?: UseStore): Promise<T[]> {
  const allKeys = await keys(store);
  const allValues = await getMany<T>(allKeys, store);
  return allValues.filter((v): v is T => v !== undefined);
}

export async function update<T = unknown>(
  key: IDBValidKey,
  updater: (oldValue: T | undefined) => T,
  store?: UseStore,
): Promise<void> {
  const current = await get<T>(key, store);
  await set(key, updater(current), store);
}
