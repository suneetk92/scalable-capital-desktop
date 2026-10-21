import { describe, expect, it } from "vitest";
import { indexedDbAdapter, memoryAdapter } from "./kvStore";

async function roundTrip(kv: ReturnType<typeof memoryAdapter>) {
  expect(await kv.get("a")).toBeUndefined();
  await kv.set("a", { n: 1 });
  await kv.set("b", [2]);
  expect(await kv.get("a")).toEqual({ n: 1 });
  expect((await kv.keys()).sort()).toEqual(["a", "b"]);
  await kv.remove("a");
  expect(await kv.get("a")).toBeUndefined();
  expect(await kv.keys()).toEqual(["b"]);
}

describe("memoryAdapter", () => {
  it("stores, reads, lists and removes values", async () => {
    await roundTrip(memoryAdapter());
  });
});

describe("indexedDbAdapter", () => {
  it("works in memory when IndexedDB is unavailable", async () => {
    await roundTrip(indexedDbAdapter("scalable-capital-desktop.test", "store", undefined));
  });

  it("works in memory when the database cannot be opened", async () => {
    const factory = {
      open: () => {
        const request: { onerror?: () => void; error?: Error } = { error: new Error("denied") };
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    } as unknown as IDBFactory;
    await roundTrip(indexedDbAdapter("scalable-capital-desktop.test", "store", factory));
  });
});
