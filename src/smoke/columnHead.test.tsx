// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ColumnHead, inOrder, resizedTable } from "../ColumnHead";
import { useTableLayout } from "../hooks/useTableLayout";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function Harness() {
  const { order, layout } = useTableLayout("smoke", ["a", "b", "c"]);
  const resized = resizedTable(layout.widths);
  return (
    <table className={resized.className} style={resized.style}>
      <thead>
        <tr>
          {order.map((id) => (
            <ColumnHead key={id} id={id} label={id} layout={layout}>
              {id}
            </ColumnHead>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>{inOrder(order, { a: <td>A</td>, b: <td>B</td>, c: <td>C</td> })}</tr>
      </tbody>
    </table>
  );
}

const heads = () => screen.getAllByRole("columnheader").map((head) => head.textContent);

describe("column header", () => {
  it("moves a column by dragging its header", () => {
    render(<Harness />);
    document.elementFromPoint = () => document.querySelector('th[data-col="c"]');
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100, right: 100, top: 0, bottom: 10, height: 10, x: 0, y: 0, toJSON: () => ({}) });
    const a = document.querySelector('th[data-col="a"]')!;
    fireEvent.pointerDown(a, { button: 0, clientX: 10, clientY: 5 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 90, clientY: 5 }));
    fireEvent(window, new MouseEvent("pointerup", { clientX: 90, clientY: 5 }));
    expect(heads()).toEqual(["b", "c", "a"]);
    expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["B", "C", "A"]);
  });

  it("resizes with the arrow keys and restores on double-click", () => {
    render(<Harness />);
    const handle = screen.getByLabelText("Resize a");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(document.querySelector("table")!.className).toContain("table-fixed");
    fireEvent.doubleClick(handle);
    expect(document.querySelector("table")!.className).not.toContain("table-fixed");
  });
});
