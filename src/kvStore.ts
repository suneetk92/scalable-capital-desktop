/** A tiny async key-value store; values are anything the structured clone algorithm accepts. */
export type KvAdapter = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
  keys: () => Promise<string[]>;
};

/** Keeps everything in memory: the fallback when IndexedDB is unavailable, and the adapter the tests use. */
export function memoryAdapter(): KvAdapter {
  const map = new Map<string, unknown>();
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => {
      map.set(key, value);
    },
    remove: async (key) => {
      map.delete(key);
    },
    keys: async () => [...map.keys()],
  };
}

const done = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });

function openDatabase(factory: IDBFactory, name: string, store: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened."));
    request.onblocked = () => reject(new Error("IndexedDB is blocked."));
  });
}

/**
 * An IndexedDB-backed store. It opens the database on first use; when that fails (no IndexedDB, private
 * mode, a blocked upgrade) it keeps working in memory for the rest of the session.
 */
export function indexedDbAdapter(name: string, store: string, factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): KvAdapter {
  const fallback = memoryAdapter();
  let opened: Promise<IDBDatabase | null> | null = null;
  const database = () => {
    opened ??= factory ? openDatabase(factory, name, store).catch(() => null) : Promise.resolve(null);
    return opened;
  };
  const run = async (mode: IDBTransactionMode, use: (objects: IDBObjectStore) => IDBRequest, otherwise: () => Promise<unknown>): Promise<unknown> => {
    const db = await database();
    if (!db) return otherwise();
    try {
      return await done(use(db.transaction(store, mode).objectStore(store)));
    } catch {
      return otherwise();
    }
  };
  return {
    get: (key) =>
      run(
        "readonly",
        (objects) => objects.get(key),
        () => fallback.get(key),
      ),
    set: async (key, value) => {
      await run(
        "readwrite",
        (objects) => objects.put(value, key),
        () => fallback.set(key, value),
      );
    },
    remove: async (key) => {
      await run(
        "readwrite",
        (objects) => objects.delete(key),
        () => fallback.remove(key),
      );
    },
    keys: async () =>
      (
        (await run(
          "readonly",
          (objects) => objects.getAllKeys(),
          () => fallback.keys(),
        )) as IDBValidKey[]
      ).map(String),
  };
}
