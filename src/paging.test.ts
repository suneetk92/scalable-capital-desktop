import { describe, expect, it } from "vitest";
import { paginate } from "./paging";

const items = [1, 2, 3, 4, 5];

describe("paginate", () => {
  it("returns the rows of the asked page", () => {
    expect(paginate(items, 2, 2)).toEqual({ rows: [3, 4], page: 2, pageCount: 3, size: 2 });
  });

  it("keeps the page inside the range", () => {
    expect(paginate(items, 9, 2).rows).toEqual([5]);
    expect(paginate(items, 0, 2).rows).toEqual([1, 2]);
  });

  it("shows everything on one page when the size is 0", () => {
    expect(paginate(items, 3, 0)).toEqual({ rows: items, page: 1, pageCount: 1, size: 5 });
  });

  it("handles no items", () => {
    expect(paginate([], 1, 10)).toEqual({ rows: [], page: 1, pageCount: 1, size: 10 });
    expect(paginate([], 1, 0).pageCount).toBe(1);
  });
});
