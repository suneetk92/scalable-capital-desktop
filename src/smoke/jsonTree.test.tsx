// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { JsonTree } from "../JsonTree";

afterEach(cleanup);

const value = { outer: { inner: { deep: { leaf: "hidden until opened" } } }, skipped: undefined, list: [undefined, 1] };

describe("JsonTree", () => {
  it("renders the children of a collapsed node only once it is opened", () => {
    const { container } = render(<JsonTree value={value} />);
    // Depth 0 and 1 start open; `inner` (depth 2) is collapsed, so its children are not rendered yet.
    expect(screen.queryByText(/hidden until opened/)).toBeNull();
    const inner = [...container.querySelectorAll("details")].find((details) => details.querySelector("summary")?.textContent?.startsWith('"inner"'));
    expect(inner?.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText(/hidden until opened/)).toBeTruthy();
  });

  it("keeps the same elements when everything is expanded or collapsed", () => {
    const { container } = render(<JsonTree value={value} />);
    const root = container.querySelector("details");
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(container.querySelector("details")).toBe(root);
    expect(root?.open).toBe(false);
  });

  it("leaves out undefined like JSON.stringify", () => {
    const { container } = render(<JsonTree value={value} />);
    expect(container.textContent).not.toContain("skipped");
    expect(container.textContent).toContain("null");
    expect(render(<JsonTree value={undefined} />).container.textContent).toBe("");
  });
});
