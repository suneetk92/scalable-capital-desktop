import { describe, expect, it } from "vitest";
import { boundHistory, createHistoryStore, MAX_STORED_PER_PORTFOLIO, parsePage, syncHistory, type CachedHistory, type LegacyStorage, type PageRequest, type TransactionPage } from "./activityCache";
import { memoryAdapter } from "./kvStore";
import type { Rec } from "./response";

const tx = (id: string, status = "SETTLED"): Rec => ({ id, status, kind: "cash", description: "dropped", cash: { transactionType: "DEPOSIT", amount: "10", relatedIsin: null } });

const page = (records: Rec[], cursor: string | null, extra: Partial<TransactionPage> = {}): TransactionPage => ({ records, cursor, cryptoRecords: [], cryptoCursor: null, total: null, ...extra });

/** A fake server holding `ids` newest first and answering with pages of `size`; counts the requests. */
function server(ids: string[], size: number, status = "SETTLED") {
  const requests: PageRequest[] = [];
  const fetchPage = async (request: PageRequest) => {
    requests.push(request);
    const start = request.cursor ? Number(request.cursor) : 0;
    const next = start + size;
    return page(
      ids.slice(start, next).map((id) => tx(id, status)),
      next < ids.length ? String(next) : null,
      { total: ids.length },
    );
  };
  return { requests, fetchPage };
}

describe("parsePage", () => {
  it("reads the broker and the crypto part with their own cursors", () => {
    const parsed = parsePage({
      portfolioId: "p",
      page: { nextCursor: "a", totalCount: 7, returnedCount: 1 },
      transactions: [{ id: "1" }],
      crypto: { page: { nextCursor: "", totalCount: null, returnedCount: 1 }, transactions: [{ id: "c1" }] },
    });
    expect(parsed).toEqual({ records: [{ id: "1" }], cursor: "a", cryptoRecords: [{ id: "c1" }], cryptoCursor: null, total: 7 });
  });

  it("returns an empty page for anything else", () => {
    expect(parsePage(null)).toEqual(page([], null));
    expect(parsePage(JSON.stringify({ error: { code: "x" } }))).toEqual(page([], null));
  });
});

describe("syncHistory", () => {
  it("reads every page of a first load and keeps only the fields the calculations use", async () => {
    const { requests, fetchPage } = server(["1", "2", "3", "4", "5"], 2);
    const progress: number[] = [];
    const history = await syncHistory(fetchPage, null, (item) => progress.push(item.loaded));
    expect(history.records.map((record) => record.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(history.records[0]).not.toHaveProperty("description");
    expect(requests).toEqual([{}, { cursor: "2" }, { cursor: "4" }]);
    expect(progress).toEqual([2, 4, 5]);
  });

  it("fetches only the new pages when a history is stored", async () => {
    const first = await syncHistory(server(["3", "4", "5", "6"], 2).fetchPage, null);
    const later = server(["1", "2", "3", "4", "5", "6"], 2);
    const history = await syncHistory(later.fetchPage, first);
    expect(history.records.map((record) => record.id).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(later.requests).toEqual([{}, { cursor: "2" }]);
  });

  it("stitches hundreds of new transactions onto a stored history and stops at the first known page", async () => {
    const old = Array.from({ length: 300 }, (_, index) => `old${index}`);
    const first = await syncHistory(server(old, 100).fetchPage, null);
    const fresh = Array.from({ length: 500 }, (_, index) => `new${index}`);
    const later = server([...fresh, ...old], 100);
    const history = await syncHistory(later.fetchPage, first);
    expect(history.records).toHaveLength(800);
    expect(new Set(history.records.map((record) => record.id)).size).toBe(800);
    expect(later.requests).toHaveLength(6);
  });

  it("checkpoints a long first load and carries on from the checkpoint after an interruption", async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `t${index}`);
    const full = server(ids, 1);
    let served = 0;
    const checkpoints: CachedHistory[] = [];
    await expect(
      syncHistory(
        async (request) => {
          served += 1;
          if (served > 7) throw new Error("closed");
          return full.fetchPage(request);
        },
        null,
        undefined,
        (partial) => checkpoints.push(partial),
      ),
    ).rejects.toThrow("closed");
    expect(checkpoints).toHaveLength(1);
    const stored = checkpoints[0] as CachedHistory;
    expect(stored.records).toHaveLength(5);
    expect(stored.resume).toEqual({ cursor: "5", mainDone: false, cryptoDone: true });

    const later = server(["n1", ...ids], 1);
    const history = await syncHistory(later.fetchPage, stored);
    expect(history.resume).toBeUndefined();
    expect(history.records.map((record) => record.id).sort()).toEqual(["n1", ...ids].sort());
    expect(later.requests[0]).toEqual({});
    expect(later.requests[later.requests.length - 1]).toEqual({ cursor: "12" });
  });

  it("stops after the first page when nothing is new", async () => {
    const first = await syncHistory(server(["1", "2", "3", "4"], 2).fetchPage, null);
    const same = server(["1", "2", "3", "4"], 2);
    await syncHistory(same.fetchPage, first);
    expect(same.requests).toEqual([{}]);
  });

  it("takes up a changed status without counting the transaction twice", async () => {
    const first = await syncHistory(server(["1", "2"], 5, "PENDING").fetchPage, null);
    const history = await syncHistory(server(["1", "2"], 5, "SETTLED").fetchPage, first);
    expect(history.records).toHaveLength(2);
    expect(history.records.map((record) => record.status)).toEqual(["SETTLED", "SETTLED"]);
  });

  it("pages crypto with its own cursor and keeps going after the broker part is done", async () => {
    const requests: PageRequest[] = [];
    const fetchPage = async (request: PageRequest): Promise<TransactionPage> => {
      requests.push(request);
      if (!request.cryptoCursor) return page([tx("1")], null, { cryptoRecords: [tx("c1")], cryptoCursor: "k1" });
      return page([tx("1")], null, { cryptoRecords: [tx("c2")], cryptoCursor: null });
    };
    const history = await syncHistory(fetchPage, null);
    expect(history.records.map((record) => record.id)).toEqual(["1", "c1", "c2"]);
    expect(requests).toEqual([{}, { cryptoCursor: "k1" }]);
  });

  it("stops when a cursor does not advance", async () => {
    let calls = 0;
    const fetchPage = async (): Promise<TransactionPage> => page([tx(String((calls += 1)))], "same");
    const history = await syncHistory(fetchPage, null);
    expect(history.records).toHaveLength(2);
  });

  it("throws when a page fails, so the stored history is not replaced", async () => {
    const fetchPage = async (request: PageRequest): Promise<TransactionPage> => {
      if (request.cursor) throw new Error("rate limited");
      return page([tx("1")], "next");
    };
    await expect(syncHistory(fetchPage, null)).rejects.toThrow("rate limited");
  });
});

/** A `localStorage` stand-in. */
function legacyStorage(initial: Record<string, string>): LegacyStorage & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

const LEGACY = "scalable-capital-desktop.transactions.";
const history = (count: number, syncedAt = 5): CachedHistory => ({
  syncedAt,
  records: Array.from({ length: count }, (_, index) => ({ id: `t${index}`, lastEventAt: new Date(Date.UTC(2020, 0, 1) + index * 1000).toISOString() })),
});

describe("history store", () => {
  it("saves and loads a history, with its resume state", async () => {
    const store = createHistoryStore(memoryAdapter(), null);
    expect(await store.load("p1")).toBeNull();
    const saved: CachedHistory = { ...history(3), resume: { cursor: "c", mainDone: false, cryptoDone: true } };
    expect(await store.save("p1", saved)).toBe(true);
    expect(await store.load("p1")).toEqual(saved);
    expect(store.count()).toBe(3);
  });

  it("ignores a stored value that is not a history", async () => {
    const kv = memoryAdapter();
    await kv.set("p1", { records: "nope" });
    expect(await createHistoryStore(kv, null).load("p1")).toBeNull();
  });

  it("moves the old localStorage entries to the database once and removes them", async () => {
    const legacy = legacyStorage({
      [`${LEGACY}p1`]: JSON.stringify(history(4, 9)),
      [`${LEGACY}p2`]: JSON.stringify({ broken: true }),
      "scalable-capital-desktop.settings": "{}",
    });
    const kv = memoryAdapter();
    const store = createHistoryStore(kv, legacy);
    await store.ready;
    expect([...legacy.items.keys()]).toEqual(["scalable-capital-desktop.settings"]);
    expect(await store.load("p1")).toEqual(history(4, 9));
    expect(await store.load("p2")).toBeNull();
    expect(await kv.keys()).toEqual(["p1"]);
    // A second start finds nothing left to move.
    expect(await createHistoryStore(kv, legacy).load("p1")).toEqual(history(4, 9));
  });

  it("does not overwrite a history that is already in the database", async () => {
    const kv = memoryAdapter();
    await kv.set("p1", history(2, 50));
    const legacy = legacyStorage({ [`${LEGACY}p1`]: JSON.stringify(history(4, 9)) });
    const store = createHistoryStore(kv, legacy);
    await store.ready;
    expect((await store.load("p1"))?.syncedAt).toBe(50);
    expect(legacy.items.size).toBe(0);
  });

  it("keeps an entry it cannot move for the next launch", async () => {
    const kv = memoryAdapter();
    const failing = {
      ...kv,
      set: async () => {
        throw new Error("full");
      },
    };
    const legacy = legacyStorage({ [`${LEGACY}p1`]: JSON.stringify(history(2)) });
    await createHistoryStore(failing, legacy).ready;
    expect(legacy.items.size).toBe(1);
  });

  it("stores at most the newest transactions per portfolio", async () => {
    const store = createHistoryStore(memoryAdapter(), null);
    await store.save("p1", history(MAX_STORED_PER_PORTFOLIO + 25));
    const stored = await store.load("p1");
    expect(stored?.records).toHaveLength(MAX_STORED_PER_PORTFOLIO);
    // The oldest 25 are the ones dropped.
    expect(stored?.records[0]?.id).toBe("t25");
    expect(store.count()).toBe(MAX_STORED_PER_PORTFOLIO);
  });

  it("clears every history, bumps the generation and makes a following load wait for it", async () => {
    const store = createHistoryStore(memoryAdapter(), null);
    await store.save("p1", history(2));
    await store.save("p2", history(3));
    const before = store.generation();
    store.clear();
    expect(store.generation()).toBe(before + 1);
    expect(store.count()).toBe(0);
    expect(await store.load("p1")).toBeNull();
    expect(await store.load("p2")).toBeNull();
  });
});

describe("boundHistory", () => {
  it("returns a history within the limit as it is", () => {
    const small = history(3);
    expect(boundHistory(small)).toBe(small);
  });

  it("keeps the newest by date in their original order, and drops records without a date first", () => {
    const records: Rec[] = [{ id: "undated" }, ...history(MAX_STORED_PER_PORTFOLIO).records];
    const bounded = boundHistory({ syncedAt: 1, records });
    expect(bounded.records).toHaveLength(MAX_STORED_PER_PORTFOLIO);
    expect(bounded.records.some((record) => record.id === "undated")).toBe(false);
    expect(bounded.records[0]?.id).toBe("t0");
    expect(bounded.syncedAt).toBe(1);
  });
});
