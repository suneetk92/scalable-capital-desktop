import type { Page } from "@playwright/test";
import { dashboard } from "./mockData";
import { generateResult } from "./schemaData";

/** Commands that may be answered with canned data. Anything else rejects, so a test never reaches a real account. */
const toolNames = Object.fromEntries(dashboard.toolDefs.map((tool: { name: string }) => [tool.name, true]));
const READ_ONLY_TOOL = /^(get_|list_|search_|preview_)/;

/** Replaces the Tauri runtime of the page with canned answers: the app then runs in a plain browser with made-up data. */
export async function mockTauri(page: Page) {
  const generate = Object.fromEntries(Object.keys(toolNames).map((name) => [name, generateResult(name)]));
  await page.addInitScript((data) => {
    const calls: { command: string; args: unknown }[] = [];
    (window as unknown as { __mockCalls: typeof calls }).__mockCalls = calls;
    const answer = (command: string, args: Record<string, unknown> | undefined): unknown => {
      switch (command) {
        case "load_dashboard":
          return data.dashboard;
        case "login_status":
          return { status: "authenticated" };
        case "get_session_info":
          return { signedIn: true, signedInAt: 0, accessExpiresAt: 3600, refreshIssuedAt: 0, refreshExpiresAt: null };
        case "get_background":
          return { enabled: false, supported: false };
        case "call_tools": {
          const requested = (args?.calls ?? []) as { name: string }[];
          return requested.map((call) => ({ name: call.name, ok: true, result: data.generate[call.name] }));
        }
        case "set_trading_enabled":
        case "set_trailing_interval":
          return null;
        case "list_trailing_stops":
          return [];
        case "search_securities":
          return [];
        case "load_tool_schemas":
          return data.dashboard.toolDefs;
        default:
          throw new Error(`The mock has no answer for "${command}"`);
      }
    };
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
      transformCallback: () => 0,
      unregisterCallback: () => {},
      convertFileSrc: (path: string) => path,
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "call_tools" && ((args?.calls ?? []) as { name: string }[]).some((call) => !new RegExp(data.readOnly).test(call.name))) {
          throw new Error("The mock refuses write tools");
        }
        return answer(command, args);
      },
    };
  }, { dashboard, readOnly: READ_ONLY_TOOL.source, generate });
}
