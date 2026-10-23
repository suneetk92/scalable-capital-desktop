import { describe, expect, it } from "vite-plus/test";
import { mapChunked } from "./chunked";

describe("mapChunked", () => {
  it("maps every item in order and yields between the slices", async () => {
    let yields = 0;
    const out = await mapChunked([1, 2, 3, 4, 5], (value, index) => value * 10 + index, {
      size: 2,
      yieldFn: async () => {
        yields += 1;
      },
    });
    expect(out).toEqual([10, 21, 32, 43, 54]);
    expect(yields).toBe(2);
  });

  it("does not yield for a list that fits one slice, or for an empty list", async () => {
    let yields = 0;
    const yieldFn = async () => {
      yields += 1;
    };
    expect(await mapChunked([1, 2], (value) => value, { size: 5, yieldFn })).toEqual([1, 2]);
    expect(await mapChunked([], (value) => value, { size: 5, yieldFn })).toEqual([]);
    expect(yields).toBe(0);
  });

  it("works through the slices with the default yield", async () => {
    const items = Array.from({ length: 1200 }, (_, index) => index);
    expect(await mapChunked(items, (value) => value + 1)).toHaveLength(1200);
  });

  it("stops and gives null once cancelled, without touching the rest", async () => {
    let calls = 0;
    let stop = false;
    const out = await mapChunked(
      [1, 2, 3, 4, 5, 6],
      (value) => {
        calls += 1;
        return value;
      },
      {
        size: 2,
        cancelled: () => stop,
        yieldFn: async () => {
          stop = true;
        },
      },
    );
    expect(out).toBeNull();
    expect(calls).toBe(2);
  });
});
