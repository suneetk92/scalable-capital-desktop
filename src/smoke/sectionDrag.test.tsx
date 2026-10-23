// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useSectionDrag, type SectionDrag } from "../hooks/useSectionDrag";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ onDrop, onClick }: { onDrop: (drag: SectionDrag<string>, section: string) => void; onClick: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const { drag, dropKey, startDrag } = useSectionDrag<string>({ container, canDrop: (item, key) => key !== item.key && key !== "locked", onDrop });
  return (
    <div ref={container}>
      <table>
        <tbody>
          {["a", "b", "locked"].map((key) => (
            <tr key={key} data-section={key} data-testid={key} data-drop={dropKey === key ? "yes" : "no"}>
              <td>
                <button type="button" onPointerDown={(event) => startDrag(event, { kind: "row", key, row: `row-${key}`, label: key })} onClick={onClick}>
                  {key}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <output>{drag ? `dragging ${drag.label}` : "idle"}</output>
    </div>
  );
}

function pointAt(key: string) {
  vi.spyOn(document, "elementFromPoint").mockImplementation(() => screen.getByTestId(key));
}

describe("section drag and drop", () => {
  it("drops a row on another section and swallows the click that ends the drag", () => {
    const onDrop = vi.fn();
    const onClick = vi.fn();
    document.elementFromPoint = () => null;
    render(<Harness onDrop={onDrop} onClick={onClick} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "a" }), { button: 0, clientX: 10, clientY: 10 });
    pointAt("b");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 40 });
    expect(screen.getByRole("status").textContent).toBe("dragging a");
    expect(screen.getByTestId("b").dataset.drop).toBe("yes");
    expect(document.documentElement.classList.contains("select-none")).toBe(true);

    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(onDrop).toHaveBeenCalledWith({ kind: "row", key: "a", row: "row-a", label: "a" }, "b");
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("idle");
    expect(document.documentElement.classList.contains("select-none")).toBe(false);
  });

  it("ignores small movements, refused targets and Escape", () => {
    const onDrop = vi.fn();
    document.elementFromPoint = () => null;
    render(<Harness onDrop={onDrop} onClick={() => {}} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "a" }), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 12, clientY: 12 });
    expect(screen.getByRole("status").textContent).toBe("idle");

    pointAt("locked");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 60 });
    expect(screen.getByTestId("locked").dataset.drop).toBe("no");
    fireEvent.pointerUp(window);
    expect(onDrop).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole("button", { name: "a" }), { button: 0, clientX: 10, clientY: 10 });
    pointAt("b");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 40 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window);
    expect(onDrop).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("idle");
  });
});
