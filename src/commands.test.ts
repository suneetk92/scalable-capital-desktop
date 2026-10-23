import { describe, expect, it, vi } from "vite-plus/test";
import libRs from "../src-tauri/src/lib.rs?raw";
import { COMMAND_NAMES, invokeCommand, TOOL } from "./commands";

/** The command names inside `tauri::generate_handler![ ... ]`, without their module path. */
function registeredInRust(): string[] {
  const list = /generate_handler!\[([^\]]*)\]/.exec(libRs);
  if (!list) throw new Error("generate_handler![...] not found in src-tauri/src/lib.rs");
  return list[1]
    .split("\n")
    .map((line) =>
      line
        .replace(/\/\/.*$/, "")
        .trim()
        .replace(/,$/, ""),
    )
    .filter(Boolean)
    .map((path) => path.split("::").pop() as string);
}

describe("the command registry", () => {
  const rust = registeredInRust();

  it("reads the handler list from lib.rs", () => {
    expect(rust.length).toBeGreaterThan(10);
    expect(new Set(rust).size).toBe(rust.length);
  });

  it("names only commands that lib.rs registers", () => {
    expect(COMMAND_NAMES.filter((name) => !rust.includes(name))).toEqual([]);
  });

  it("covers every command that lib.rs registers", () => {
    expect(rust.filter((name) => !COMMAND_NAMES.includes(name))).toEqual([]);
  });

  it("passes the name and the arguments to the injected invoke", async () => {
    const invoke = vi.fn().mockResolvedValue("ok");
    await invokeCommand(invoke, "search_securities", { query: "msci" });
    await invokeCommand(invoke, "logout");
    expect(invoke).toHaveBeenNthCalledWith(1, "search_securities", { query: "msci" });
    expect(invoke).toHaveBeenNthCalledWith(2, "logout", undefined);
  });
});

describe("the tool names", () => {
  it("are distinct and written the way Scalable names them", () => {
    const names = Object.values(TOOL);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });
});
