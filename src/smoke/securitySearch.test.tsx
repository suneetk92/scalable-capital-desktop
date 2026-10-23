// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SecuritySearchResults } from "../SecuritySearch";
import type { Invoke } from "../tools";

const PAYLOAD = [
  { isin: "DE0005190003", name: "BMW St.", symbol: "BMW" },
  { isin: "US0378331005", name: "Apple", symbol: "AAPL" },
];

function setup(text: string) {
  const invoke = vi.fn(async () => PAYLOAD) as unknown as Invoke;
  const view = render(<SecuritySearchResults text={text} invoke={invoke} enabled watched={new Set(["US0378331005"])} held={new Set()} onOpen={() => {}} />);
  return { invoke, view };
}

describe("SecuritySearchResults", () => {
  afterEach(() => vi.useRealTimers());

  it("asks Scalable only from three characters", async () => {
    vi.useFakeTimers();
    const short = setup("bm");
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(short.invoke).not.toHaveBeenCalled();
    expect(screen.queryByText("Discover")).toBeNull();
    short.view.unmount();

    const long = setup("bmw");
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(long.invoke).toHaveBeenCalledWith("search_securities", {
      query: "bmw",
    });
    expect(screen.getByText("BMW St.")).toBeTruthy();
    expect(screen.getByText("On watchlist")).toBeTruthy();
  });
});
