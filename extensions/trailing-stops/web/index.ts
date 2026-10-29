import { createElement, Fragment, lazy, Suspense, useEffect, useState } from "react";
import { ArrowTrendingDownIcon } from "@heroicons/react/24/outline";
import { hasTauriRuntime } from "../../../src/app/invoke";
import { Select } from "../../../src/controls";
import type { AppExtension, ExtensionContext, ExtensionOrderProps } from "../../../src/extensions";
import { intervalLabel, REFRESH_OPTIONS } from "../../../src/refreshOptions";
import { btn } from "../../../src/ui";
import manifest from "../extension.json";
import { migrateLegacySettings, updateTrailingSettings, useTrailingSettings } from "./settings";
import { invokeCommand } from "./src/commands";
import { useTrailingStops } from "./src/useTrailingStops";

// The page and the dialog load on first use: the core settings import this module while they initialise.
const TrailingStops = lazy(() => import("./src/TrailingStops").then((module) => ({ default: module.TrailingStops })));
const TrailingStopDialog = lazy(() => import("./src/TrailingStopDialog").then((module) => ({ default: module.TrailingStopDialog })));

type TrailingData = { trailing: ReturnType<typeof useTrailingStops>; checkSeconds: number };

const asData = (context: ExtensionContext) => context.data.extensionData as TrailingData;

function useExtensionData(context: { invoke: Parameters<typeof useTrailingStops>[0] }): TrailingData {
  const trailing = useTrailingStops(context.invoke);
  const { checkSeconds } = useTrailingSettings();
  // The watcher runs in Rust and uses 30 seconds until it is told the setting.
  useEffect(() => {
    if (!hasTauriRuntime()) return;
    invokeCommand(context.invoke, "set_trailing_interval", { seconds: checkSeconds }).catch(() => {});
  }, [context.invoke, checkSeconds]);
  return { trailing, checkSeconds };
}

function TrailingRoute({ context }: { context: ExtensionContext }) {
  return createElement(TrailingStops, { common: context.data.common, trailing: asData(context).trailing, onOpenSecurity: context.commands.openFound });
}

function TrailingSettings() {
  const { checkSeconds } = useTrailingSettings();
  return createElement(
    "section",
    { className: "border-t border-line py-4", "aria-label": "Trailing stops" },
    createElement("h3", { className: "mb-2.5 font-semibold tracking-wider text-ink-muted uppercase" }, "Trailing stops"),
    createElement(
      "div",
      { className: "flex items-center justify-between gap-5 py-3" },
      createElement(
        "div",
        null,
        createElement("div", { className: "text-ink-body" }, "Trailing stops check frequency"),
        createElement(
          "p",
          { className: "text-ink-muted" },
          "How often the app reads the price of each security with a trailing stop loss or buy stop. Shorter reacts faster to a price move but makes more requests to Scalable, which may throttle them. Checks run only while the app runs, you are signed in and Trading is on.",
        ),
      ),
      createElement(Select, {
        size: "compact",
        label: "Trailing stops check frequency",
        value: checkSeconds,
        onChange: (seconds) => updateTrailingSettings({ checkSeconds: Number(seconds) }),
        options: REFRESH_OPTIONS.map(([value, label]) => ({ value, label })),
      }),
    ),
  );
}

function ProtectionActions({ invoke, security, portfolioId, quantity, portfolios, held }: ExtensionOrderProps) {
  const [open, setOpen] = useState(false);
  return createElement(
    Fragment,
    null,
    createElement("button", { className: btn.secondary, type: "button", onClick: () => setOpen(true) }, "Set trailing stop loss"),
    open &&
      createElement(Suspense, { fallback: null }, createElement(TrailingStopDialog, { security, portfolioId, quantity, portfolios, held, invoke, manageEnabled: true, onClose: () => setOpen(false) })),
  );
}

const appExtension: AppExtension = {
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  description: manifest.description,
  useData: useExtensionData,
  migrateLegacy: migrateLegacySettings,
  views: [
    {
      id: "trailing",
      label: "Trailing stops",
      icon: ArrowTrendingDownIcon,
      title: "Trailing stops",
      description: "Stop losses that sell and buy stops that buy when the price moves by your distance, watched by this app.",
      after: "alerts",
      trading: true,
      count: (context) => asData(context).trailing.stops.length,
      refresh: (context) => {
        const { trailing, checkSeconds } = asData(context);
        return {
          auto: trailing.stops.some((stop) => stop.status === "active"),
          label: intervalLabel(checkSeconds),
          busy: trailing.checking,
          refresh: () => void trailing.checkNow(),
          lastLoadedAt: trailing.lastChecked ?? trailing.openedAt,
          intervalMs: checkSeconds * 1000,
        };
      },
      render: (context) => createElement(TrailingRoute, { context }),
    },
  ],
  settingsSection: TrailingSettings,
  orderProtection: {
    note: "A trailing stop loss is not a Scalable order: the app follows the price itself and sells at market, only while it runs with Trading on.",
    Actions: ProtectionActions,
  },
};

export default appExtension;
