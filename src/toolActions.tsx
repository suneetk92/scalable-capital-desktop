import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNotifications, type Notifications } from "./hooks/useNotifications";
import { withLastGood } from "./lastGood";
import { toolSuccessNotice, type Notice } from "./notifications";
import { ConfirmModal, ToolRunnerModal } from "./ToolViews";
import { Toast, ToastStack } from "./ui";
import { acceptsIsinList, buildArgs, callTools, errorText, humanize, isManageTool, isTradingTool, isWriteTool, type Invoke, type ToolDef, type ToolOutcome, withoutRecords } from "./tools";
import { pickString, type Rec } from "./response";
import { planOf } from "./savingsPlan";
import type { PagePortfolio } from "./types";
import { TOOL } from "./commands";

type RunOptions = {
  /** Asks for confirmation first; the text is shown in the dialog. */
  confirm?: string;
  confirmLabel?: string;
  /** Message shown after success; `false` shows none, for a step whose caller reports the whole change. */
  done?: string | Notice | false;
  /** Update the data on screen afterwards (default true). A batch can leave it to its last call. */
  refresh?: boolean;
};

export type ToolActions = {
  run: (name: string, semantic: Rec, options?: RunOptions) => Promise<ToolOutcome | null>;
  openRunner: (name: string, prefill?: Rec) => void;
  notify: (notice: Notice, options?: { toast?: boolean; desktop?: boolean }) => void;
  /** Whether the tool is offered; tools that change data count as offered only while Trading is on. */
  has: (name: string) => boolean;
};

/** Called after a write succeeded; `semantic` names what changed (isin, groupId, ...). */
type Args = { invoke: Invoke; defs: ToolDef[]; portfolios: PagePortfolio[]; tradingEnabled: boolean; manageEnabled: boolean; inApp: boolean; onChanged: (tool: string, semantic: Rec) => void };

/** Runs write tools safely (trading gate, confirmation, schema mapping) and owns the dialogs for it. */
export function useToolActions({ invoke, defs, portfolios, tradingEnabled, manageEnabled, inApp, onChanged }: Args): { actions: ToolActions; ui: ReactNode; notifications: Notifications } {
  const notifications = useNotifications(invoke, inApp);
  const { notify } = notifications;
  const [runner, setRunner] = useState<{ tool: string; prefill: Rec } | null>(null);
  const [asking, setAsking] = useState<{ text: string; label: string; resolve: (ok: boolean) => void } | null>(null);

  const changed = useCallback(
    (tool: string, semantic: Rec) => {
      applyToAnswers(tool, semantic);
      onChanged(tool, semantic);
    },
    [onChanged],
  );

  const run = useCallback(
    async (name: string, semantic: Rec, options: RunOptions = {}) => {
      const def = defs.find((item) => item.name === name);
      if (!def) {
        notify({ kind: "error", text: `Scalable did not offer ${name} for this sign-in. Check the MCP access level in the Scalable app.` });
        return null;
      }
      if (isTradingTool(name) && !tradingEnabled) {
        notify({ kind: "error", text: `${humanize(name)} changes money or orders. Switch to Full access (top right) while the exchange is open first.` });
        return null;
      }
      if (isManageTool(name) && !manageEnabled) {
        notify({ kind: "error", text: `${humanize(name)} changes your account. Switch to Restricted or Full access (top right) first.` });
        return null;
      }
      if (options.confirm) {
        const confirmed = await new Promise<boolean>((resolve) => setAsking({ text: options.confirm!, label: options.confirmLabel ?? "Confirm", resolve }));
        setAsking(null);
        if (!confirmed) return null;
      }
      const list = Array.isArray(semantic.isins) ? (semantic.isins as unknown[]) : null;
      const variants: Rec[] = list && !acceptsIsinList(def) ? list.map((isin) => ({ ...semantic, isins: undefined, isin })) : [semantic];
      const built = variants.map((variant) => buildArgs(def, variant));
      const incomplete = built.find((item) => item.missing.length > 0);
      if (incomplete) {
        setRunner({ tool: name, prefill: incomplete.args });
        notify({ kind: "info", text: `${humanize(name)} needs more details: ${incomplete.missing.map(humanize).join(", ")}.` });
        return null;
      }
      try {
        const outcomes = await callTools(
          invoke,
          built.map((item) => ({ name, arguments: item.args })),
        );
        const failed = outcomes.find((outcome) => !outcome.ok);
        if (failed) {
          notify({ kind: "error", text: failed.error ?? `${humanize(name)} failed.` });
          return failed;
        }
        if (options.done !== false) notify(typeof options.done === "object" ? options.done : { kind: "ok", text: options.done ?? `${humanize(name)} done.` });
        if (options.refresh !== false) changed(name, semantic);
        return outcomes[0] ?? null;
      } catch (runError) {
        notify({ kind: "error", text: errorText(runError) });
        return null;
      }
    },
    [defs, invoke, notify, changed, tradingEnabled, manageEnabled],
  );

  const openRunner = useCallback(
    (tool: string, prefill: Rec = {}) => {
      const def = defs.find((item) => item.name === tool);
      // Map meaning-based values to the schema's property names so the form is pre-filled.
      setRunner({ tool, prefill: def ? buildArgs(def, prefill).args : prefill });
    },
    [defs],
  );

  // Each access level offers only the tools it allows, so the buttons for the others are not shown.
  const has = useCallback(
    (name: string) => (isTradingTool(name) ? tradingEnabled : isManageTool(name) ? manageEnabled : !isWriteTool(name)) && defs.some((item) => item.name === name),
    [defs, tradingEnabled, manageEnabled],
  );
  const actions = useMemo<ToolActions>(() => ({ run, openRunner, notify, has }), [run, openRunner, notify, has]);

  const ui = (
    <>
      {runner && (
        <ToolRunnerModal
          defs={defs}
          portfolios={portfolios}
          initialTool={runner.tool}
          prefill={runner.prefill}
          invoke={invoke}
          tradingEnabled={tradingEnabled}
          manageEnabled={manageEnabled}
          onChanged={changed}
          onSuccess={(tool, args, result) => notify(toolSuccessNotice(tool, args, result))}
          onClose={() => setRunner(null)}
        />
      )}
      {asking && <ConfirmModal text={asking.text} label={asking.label} onResult={(ok) => asking.resolve(ok)} />}
      {notifications.toasts.length > 0 && (
        <ToastStack>
          {notifications.toasts.map((toast) => (
            <Toast key={toast.id} kind={toast.kind} title={toast.title} onDismiss={() => notifications.dismissToast(toast.id)}>
              {toast.text}
            </Toast>
          ))}
        </ToastStack>
      )}
    </>
  );
  return { actions, ui, notifications };
}

export type QueryEntry = { semantic: Rec; outcome: ToolOutcome };

const MAX_CACHED_QUERIES = 200;
// Successful answers by tool, arguments and reload key, so opening a page again shows them without asking Scalable.
const answers = new Map<string, QueryEntry[]>();

const answerListeners = new Set<(name: string) => void>();

/** Removes matching records from the cached answers of a tool and updates the pages showing them, without asking Scalable again. */
function dropFromAnswers(name: string, match: (record: Rec) => boolean) {
  for (const [key, entries] of answers) {
    if (!key.startsWith(`${name}|`)) continue;
    answers.set(
      key,
      entries.map((entry) => (entry.outcome.ok ? { ...entry, outcome: { ...entry.outcome, result: withoutRecords(entry.outcome.result, match) } } : entry)),
    );
  }
  answerListeners.forEach((listener) => listener(name));
}

/** Forgets the cached answers of a tool; the pages showing them ask Scalable for just that list again and keep the old one meanwhile. */
function staleAnswers(name: string) {
  for (const key of [...answers.keys()]) if (key.startsWith(`${name}|`)) answers.delete(key);
  answerListeners.forEach((listener) => listener(name));
}

const ALERT_ID_KEYS = ["alertId", "priceAlertId", "id"];

/**
 * Brings the cached lists in line with a write that succeeded. A removal is taken out of the list
 * on the spot; for an addition, only the one list that changed is read again (its new id is Scalable's).
 */
function applyToAnswers(tool: string, semantic: Rec) {
  if (tool === "remove_price_alert") {
    const alertId = pickString(semantic, ALERT_ID_KEYS);
    if (alertId) dropFromAnswers(TOOL.listPriceAlerts, (record) => pickString(record, ALERT_ID_KEYS) === alertId);
    else staleAnswers(TOOL.listPriceAlerts);
  } else if (tool === "remove_savings_plan") {
    const isin = pickString(semantic, ["isin"]);
    if (isin) dropFromAnswers(TOOL.listSavingsPlans, (record) => planOf(record).isin === isin);
    else staleAnswers(TOOL.listSavingsPlans);
  } else if (tool.includes("price_alert")) {
    staleAnswers(TOOL.listPriceAlerts);
  } else if (tool.includes("savings_plan")) {
    staleAnswers(TOOL.listSavingsPlans);
  }
}

/** Forgets every cached answer, for a sign-out. */
export function clearToolQueryCache() {
  answers.clear();
}

/**
 * Calls a read-only tool once per entry in `argsList` (null waits). Refetches when the arguments,
 * `reloadKey` (changes after every dashboard reload) or reload() change; keeps showing old data meanwhile.
 * A page opened again with the same arguments and `reloadKey` shows the answer it got before. When a refetch
 * fails, the last answer that worked for the same arguments stays and `staleError` carries the failure.
 */
export function useToolQuery(invoke: Invoke, defs: ToolDef[], name: string, argsList: Rec[] | null, reloadKey: unknown = 0) {
  const key = JSON.stringify(argsList);
  const reloadToken = String(reloadKey);
  const cacheKey = `${name}|${key}|${reloadToken}`;
  const [state, setState] = useState<{ loading: boolean; entries: QueryEntry[]; staleError: string | null }>(() => ({
    loading: false,
    entries: argsList ? (answers.get(cacheKey) ?? []) : [],
    staleError: null,
  }));
  // The last answer that worked for these arguments (whatever the reload key), shown on when a refresh fails.
  const lastGood = useRef<{ key: string; entries: QueryEntry[] } | null>(null);
  const [tick, setTick] = useState(0);
  const handledTick = useRef(0);
  const defsRef = useRef(defs);
  defsRef.current = defs;

  useEffect(() => {
    if (!argsList) return;
    const cached = answers.get(cacheKey);
    if (cached && tick === handledTick.current) {
      lastGood.current = { key, entries: cached };
      setState({ loading: false, entries: cached, staleError: null });
      return;
    }
    handledTick.current = tick;
    const def = defsRef.current.find((item) => item.name === name);
    const fail = (error: string) => setState({ loading: false, entries: [{ semantic: {}, outcome: { name, ok: false, error } }], staleError: null });
    const settle = (entries: QueryEntry[]) => {
      if (entries.every((entry) => entry.outcome.ok)) lastGood.current = { key, entries };
      setState({ loading: false, ...withLastGood(entries, lastGood.current?.key === key ? lastGood.current.entries : null) });
    };
    if (!def) {
      fail(`Scalable did not offer ${name} for this sign-in. Check the MCP access level in the Scalable app.`);
      return;
    }
    const seen = new Set<string>();
    const calls: { semantic: Rec; args: Rec }[] = [];
    for (const semantic of argsList) {
      const built = buildArgs(def, semantic, true);
      if (built.missing.length > 0) {
        fail(`${name} needs ${built.missing.join(", ")}. Open it from Settings → Scalable tools to fill the fields in.`);
        return;
      }
      const id = JSON.stringify(built.args);
      if (!seen.has(id)) {
        seen.add(id);
        calls.push({ semantic, args: built.args });
      }
    }
    let active = true;
    setState((current) => ({ ...current, loading: true }));
    callTools(
      invoke,
      calls.map((call) => ({ name, arguments: call.args })),
    )
      .then((outcomes) => {
        if (!active) return;
        const entries = outcomes.map((outcome, index) => ({ semantic: calls[index]?.semantic ?? {}, outcome }));
        if (entries.every((entry) => entry.outcome.ok)) {
          answers.delete(cacheKey);
          answers.set(cacheKey, entries);
          if (answers.size > MAX_CACHED_QUERIES) answers.delete(answers.keys().next().value as string);
        }
        settle(entries);
      })
      .catch((error: unknown) => {
        if (active) settle([{ semantic: {}, outcome: { name, ok: false, error: errorText(error) } }]);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, name, tick, reloadToken, invoke]);

  useEffect(() => {
    const listener = (changedTool: string) => {
      if (changedTool !== name) return;
      const cached = answers.get(cacheKey);
      if (cached) {
        lastGood.current = { key, entries: cached };
        setState((current) => ({ ...current, entries: cached, staleError: null }));
      } else setTick((value) => value + 1);
    };
    answerListeners.add(listener);
    return () => {
      answerListeners.delete(listener);
    };
  }, [cacheKey, key, name]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { ...state, reload };
}
