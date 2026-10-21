import { indexedDbAdapter, type KvAdapter } from "./kvStore";
import { isRec, parseMaybeJson, pickString, recordsOf, type Rec } from "./response";
import { STORAGE_PREFIX } from "./storage";
import type { TransactionRow } from "./transactions";

/** One fetched page of `list_portfolio_transactions`: the broker part and the crypto part each have their own cursor. */
export type TransactionPage = {
  records: Rec[];
  cursor: string | null;
  cryptoRecords: Rec[];
  cryptoCursor: string | null;
  total: number | null;
};

export type PageRequest = { cursor?: string; cryptoCursor?: string };

export type SyncProgress = { loaded: number; total: number | null };

/** Where an interrupted full load stopped: the cursors to continue from and which parts are already finished. */
type ResumeState = { cursor?: string; cryptoCursor?: string; mainDone: boolean; cryptoDone: boolean };

/** What is kept of one portfolio's history between launches; `resume` is set while the first full load is unfinished. */
export type CachedHistory = { syncedAt: number; records: Rec[]; resume?: ResumeState };

/** The `localStorage` key prefix of older versions, which kept the histories there. */
const KEY_PREFIX = `${STORAGE_PREFIX}transactions.`;
const DB_NAME = "scalable-capital-desktop.cache";
const STORE_NAME = "scalable-capital-desktop.transactions";
/** At most this many of the newest transactions are stored per portfolio, which keeps the database and the load time bounded. */
export const MAX_STORED_PER_PORTFOLIO = 10_000;
/** Newest pages are fetched until a page brings nothing new; this only stops a runaway loop (100 per page). */
const MAX_PAGES = 1000;
/** A full load is saved every this many pages, so closing the app halfway keeps what was read. */
const CHECKPOINT_EVERY = 5;

/** The fields the Overview calculations read; the rest of a record (description, custodian, ...) is not stored. */
const KEPT = [
  "id",
  "kind",
  "category",
  "status",
  "currency",
  "isCancellation",
  "lastEventAt",
  "side",
  "transactionType",
  "quantity",
  "amount",
  "ticker",
  "security",
  "cash",
  "nonTradeSecurity",
  "eltif",
];

function compact(record: Rec): Rec {
  const kept: Rec = {};
  for (const key of KEPT) if (record[key] !== undefined && record[key] !== null) kept[key] = record[key];
  return kept;
}

function cursorOf(page: unknown): string | null {
  const cursor = isRec(page) ? page.nextCursor : null;
  return typeof cursor === "string" && cursor !== "" ? cursor : null;
}

/** Reads a tool result: `transactions` and `page` for the broker part, `crypto.transactions` and `crypto.page` for crypto. */
export function parsePage(result: unknown): TransactionPage {
  const parsed = parseMaybeJson(result);
  const root = isRec(parsed) ? parsed : {};
  const crypto = isRec(root.crypto) ? root.crypto : {};
  const total = isRec(root.page) && typeof root.page.totalCount === "number" ? root.page.totalCount : null;
  return {
    records: recordsOf(root.transactions),
    cursor: cursorOf(root.page),
    cryptoRecords: recordsOf(crypto.transactions),
    cryptoCursor: cursorOf(crypto.page),
    total,
  };
}

/**
 * Loads a portfolio's transactions page by page, newest first, until every page is read. With a cached history
 * only the new pages are read: each part (broker, crypto) stops at the first page that has nothing new or
 * changed, because a new transaction or a status change moves a record to the top. The result holds the old and
 * the new records. A first full load reports a checkpoint every few pages; a stored history that carries one
 * reads what is new first and then carries on from where it stopped. Throws when a page fails; the cache is then
 * left as it was.
 */
export async function syncHistory(
  fetchPage: (request: PageRequest) => Promise<TransactionPage>,
  cached: CachedHistory | null,
  onProgress?: (progress: SyncProgress) => void,
  onCheckpoint?: (history: CachedHistory) => void,
): Promise<CachedHistory> {
  const merged = new Map<string, Rec>();
  const known = new Map<string, string>();
  for (const record of cached?.records ?? []) {
    const id = pickString(record, ["id"]);
    if (!id) continue;
    merged.set(id, record);
    known.set(id, JSON.stringify(record));
  }
  let total: number | null = null;

  /** Adds the page's records; true when any is new or changed. */
  const take = (records: Rec[]): boolean => {
    let changed = false;
    for (const raw of records) {
      const record = compact(raw);
      const id = pickString(record, ["id"]);
      if (!id) continue;
      if (known.get(id) !== JSON.stringify(record)) changed = true;
      merged.set(id, record);
    }
    return changed;
  };

  /** Reads pages from `start`; `incremental` stops each part at its first page with nothing new. */
  const walk = async (start: ResumeState, incremental: boolean, checkpoints: boolean): Promise<void> => {
    let { cursor, cryptoCursor, mainDone, cryptoDone } = start;
    for (let pages = 0; pages < MAX_PAGES && !(mainDone && cryptoDone); pages += 1) {
      const page = await fetchPage({ ...(cursor ? { cursor } : {}), ...(cryptoCursor ? { cryptoCursor } : {}) });
      total ??= page.total;
      if (!mainDone) {
        const changed = take(page.records);
        mainDone = page.records.length === 0 || page.cursor === null || page.cursor === cursor || (incremental && !changed);
        cursor = page.cursor ?? undefined;
      }
      if (!cryptoDone) {
        const changed = take(page.cryptoRecords);
        cryptoDone = page.cryptoRecords.length === 0 || page.cryptoCursor === null || page.cryptoCursor === cryptoCursor || (incremental && !changed);
        cryptoCursor = page.cryptoCursor ?? undefined;
      }
      onProgress?.({ loaded: merged.size, total: incremental ? null : total });
      if (checkpoints && !(mainDone && cryptoDone) && pages % CHECKPOINT_EVERY === CHECKPOINT_EVERY - 1) {
        onCheckpoint?.({ syncedAt: cached?.syncedAt ?? 0, records: [...merged.values()], resume: { ...(cursor ? { cursor } : {}), ...(cryptoCursor ? { cryptoCursor } : {}), mainDone, cryptoDone } });
      }
    }
  };

  const top: ResumeState = { mainDone: false, cryptoDone: false };
  const resume = cached?.resume;
  if (resume) {
    // Newer transactions first (the top of the list is already known, so this stops early), then the older pages left over.
    await walk(top, true, false);
    try {
      await walk(resume, false, true);
    } catch {
      await walk(top, false, true);
    }
  } else {
    await walk(top, known.size > 0, known.size === 0);
  }
  return { syncedAt: Date.now(), records: [...merged.values()] };
}

/** A stored value read back as a history, or null when it is not one. */
function parseHistory(parsed: unknown): CachedHistory | null {
  if (!isRec(parsed) || typeof parsed.syncedAt !== "number") return null;
  const history: CachedHistory = { syncedAt: parsed.syncedAt, records: recordsOf(parsed.records) };
  const resume = parsed.resume;
  if (isRec(resume) && typeof resume.mainDone === "boolean" && typeof resume.cryptoDone === "boolean") {
    history.resume = {
      mainDone: resume.mainDone,
      cryptoDone: resume.cryptoDone,
      ...(typeof resume.cursor === "string" ? { cursor: resume.cursor } : {}),
      ...(typeof resume.cryptoCursor === "string" ? { cryptoCursor: resume.cryptoCursor } : {}),
    };
  }
  return history;
}

const timeOf = (record: Rec): number => {
  const time = Date.parse(pickString(record, ["lastEventAt"]) ?? "");
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

/** The history with at most `MAX_STORED_PER_PORTFOLIO` records: the newest by `lastEventAt`, in their original order. */
export function boundHistory(history: CachedHistory): CachedHistory {
  if (history.records.length <= MAX_STORED_PER_PORTFOLIO) return history;
  const newest = new Set(
    history.records
      .map((record, index) => ({ index, time: timeOf(record) }))
      .sort((a, b) => (a.time === b.time ? a.index - b.index : b.time > a.time ? 1 : -1))
      .slice(0, MAX_STORED_PER_PORTFOLIO)
      .map((entry) => entry.index),
  );
  return { ...history, records: history.records.filter((_, index) => newest.has(index)) };
}

/** The part of `localStorage` the one-time migration needs. */
export type LegacyStorage = Pick<Storage, "getItem" | "removeItem" | "key" | "length">;

type HistoryStore = {
  /** The stored history of a portfolio, or null. Waits for the migration and for a clear in progress. */
  load: (portfolioId: string) => Promise<CachedHistory | null>;
  /** Stores the newest records of the history; false when it could not be stored (it is then loaded in full next time). */
  save: (portfolioId: string, history: CachedHistory) => Promise<boolean>;
  /** Forgets every stored history; a load or save that follows waits for it. */
  clear: () => void;
  /** Changes whenever the stored histories are cleared; a sync that began under an older value must not store its result. */
  generation: () => number;
  /** How many transactions were stored as far as this session has read or written them. */
  count: () => number;
  /** Resolves once the legacy `localStorage` entries have been moved. */
  ready: Promise<void>;
};

/**
 * The stored histories, one entry per portfolio in `kv`. Entries an older version kept in `localStorage`
 * (`KEY_PREFIX` + portfolio id, as JSON) are copied to `kv` once and removed from `legacy`.
 */
export function createHistoryStore(kv: KvAdapter, legacy: LegacyStorage | null): HistoryStore {
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();
  const counts = new Map<string, number>();

  const migrate = async () => {
    if (!legacy) return;
    const keys: string[] = [];
    try {
      for (let index = 0; index < legacy.length; index += 1) {
        const key = legacy.key(index);
        if (key?.startsWith(KEY_PREFIX)) keys.push(key);
      }
    } catch {
      return;
    }
    for (const key of keys) {
      try {
        const id = key.slice(KEY_PREFIX.length);
        const stored = legacy.getItem(key);
        const history = stored === null ? null : parseHistory(JSON.parse(stored));
        if (history && (await kv.get(id)) === undefined) await kv.set(id, boundHistory(history));
        legacy.removeItem(key);
      } catch {
        // An entry that cannot be read or moved stays where it is and is tried again next launch.
      }
    }
  };
  const ready = migrate().catch(() => undefined);
  const settled = async () => {
    await ready;
    await queue;
  };

  return {
    ready,
    generation: () => generation,
    count: () => [...counts.values()].reduce((sum, count) => sum + count, 0),
    load: async (portfolioId) => {
      await settled();
      try {
        const history = parseHistory(await kv.get(portfolioId));
        if (history) counts.set(portfolioId, history.records.length);
        return history;
      } catch {
        return null;
      }
    },
    save: async (portfolioId, history) => {
      await settled();
      try {
        const bounded = boundHistory(history);
        await kv.set(portfolioId, bounded);
        counts.set(portfolioId, bounded.records.length);
        return true;
      } catch {
        return false;
      }
    },
    clear: () => {
      generation += 1;
      counts.clear();
      queue = queue.then(async () => {
        try {
          for (const key of await kv.keys()) await kv.remove(key);
        } catch {
          // Storage can be unavailable; there is then nothing to clear.
        }
      });
    },
  };
}

const defaultStore = createHistoryStore(
  indexedDbAdapter(DB_NAME, STORE_NAME),
  (() => {
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  })(),
);

export const loadHistory = (portfolioId: string) => defaultStore.load(portfolioId);
export const saveHistory = (portfolioId: string, history: CachedHistory) => defaultStore.save(portfolioId, history);
export const historyGeneration = () => defaultStore.generation();
/** How many transactions are stored across all portfolios, as far as this session has read or written them. */
export const storedCount = () => defaultStore.count();
/** Forgets every stored history, for a sign-out or when the user wants a full reload. */
export const clearHistories = () => defaultStore.clear();

/** The cached records as rows for the calculations, tagged with their portfolio. */
export function historyRows(portfolioId: string, history: CachedHistory): TransactionRow[] {
  return history.records.map((record) => ({ record, portfolioId }));
}
