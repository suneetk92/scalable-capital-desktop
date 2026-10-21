import { useEffect, useRef } from "react";
import { alertMessage, alertNotices, checkAlerts, loadNotified, parseAlerts, saveNotified } from "../alerts";
import type { Notice } from "../notifications";
import { invokeCommand, TOOL } from "../commands";
import { buildArgs, callTools, type Invoke, type ToolDef } from "../tools";
import { findRecords } from "../response";
import type { PagePortfolio } from "../types";

type Args = {
  invoke: Invoke;
  defs: ToolDef[];
  portfolios: PagePortfolio[];
  /** Check only while signed in and the setting is on. */
  enabled: boolean;
  minutes: number;
  /** Also shows an in-app toast per alert; off leaves the desktop notification and the notification center. */
  toast: boolean;
  /** Called once per alert that fired, for the notification center. */
  onTriggered: (notice: Notice, options: { toast: boolean; desktop: boolean }) => void;
};

/**
 * Asks Scalable for every price alert (fired ones included) every few minutes and announces the
 * ones that fired since the last check, as a desktop notification and in the notification center.
 * Scalable's MCP has no push channel, so this only works while the app runs (the tray keeps it
 * running with the window closed) and is signed in.
 */
export function useAlertWatch({ invoke, defs, portfolios, enabled, minutes, toast, onTriggered }: Args) {
  const latest = useRef({ defs, portfolios, toast, onTriggered });
  latest.current = { defs, portfolios, toast, onTriggered };
  const offered = defs.some((def) => def.name === TOOL.listPriceAlerts);
  const portfolioKey = portfolios.map((portfolio) => portfolio.portfolioId).join(",");

  useEffect(() => {
    if (!enabled || !offered) return;
    let active = true;
    let running = false;

    const check = async () => {
      if (running) return;
      running = true;
      try {
        const def = latest.current.defs.find((item) => item.name === TOOL.listPriceAlerts);
        if (!def) return;
        const ids = latest.current.portfolios.length > 0 ? latest.current.portfolios.map((portfolio) => portfolio.portfolioId) : [undefined];
        const calls = ids.map((portfolioId) => ({ name: TOOL.listPriceAlerts, arguments: buildArgs(def, { portfolioId, activeOnly: false }, true).args }));
        const outcomes = await callTools(invoke, calls);
        const succeeded = outcomes.filter((outcome) => outcome.ok);
        if (!active || succeeded.length === 0) return;
        const alerts = parseAlerts(succeeded.flatMap((outcome) => findRecords(outcome.result)));
        const result = checkAlerts(alerts, loadNotified());
        saveNotified(result.notified);
        if (result.announce.length === 0) return;
        const { title, body } = alertMessage(result.announce);
        // A desktop notification that could not be shown falls back to the in-app toast.
        const shown = await invokeCommand(invoke, "show_notification", { title, body }).then(
          () => true,
          () => false,
        );
        if (!active) return;
        alertNotices(result.announce).forEach((notice) => latest.current.onTriggered(notice, { toast: latest.current.toast || !shown, desktop: false }));
      } catch {
        // A failed check is retried at the next interval; the Alerts page shows connection errors.
      } finally {
        running = false;
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), Math.max(1, minutes) * 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [enabled, offered, minutes, portfolioKey, invoke]);
}
