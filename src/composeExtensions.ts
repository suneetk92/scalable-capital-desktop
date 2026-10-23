import { createElement, Fragment, type ComponentType } from "react";
import type { AppExtension, ExtensionContext, ExtensionData, ExtensionDataContext, ExtensionOrderProps, ExtensionRuntime, ExtensionSlotProps, ExtensionView } from "./extensions";
import type { PaletteItem } from "./CommandPalette";
import type { MenuEntry } from "./controls";

/** What the app sees of all installed extensions together. The pieces they share are combined; the rest comes from the first extension that has it. */
type ComposedExtension = Omit<AppExtension, "id" | "name" | "version" | "description"> & {
  /** Whether the extension that owns the page has a side panel for it. */
  hasDock(view: string): boolean;
};

type DataById = Record<string, unknown>;

/** Every extension keeps its own data: the composed data is the data of each, by extension id. */
const dataOf = (id: string, data: ExtensionData): ExtensionData => (data as DataById | undefined)?.[id];

function scoped<T extends { data: ExtensionContext["data"] }>(id: string, context: T): T {
  return { ...context, data: { ...context.data, extensionData: dataOf(id, context.data.extensionData) } };
}

function ownerOf(list: readonly AppExtension[], view: string): AppExtension | undefined {
  return list.find((extension) => extension.views?.some((item) => item.id === view));
}

/** Combines the extensions of a build into the one extension the rest of the app talks to. The list never changes while the app runs, so hooks keep their order. */
export function composeExtensions(list: readonly AppExtension[]): ComposedExtension {
  const views: ExtensionView[] = list.flatMap((extension) =>
    (extension.views ?? []).map((view) => ({
      ...view,
      count: view.count && ((context: ExtensionContext) => view.count!(scoped(extension.id, context))),
      refresh: view.refresh && ((context: ExtensionContext) => view.refresh!(scoped(extension.id, context))),
      render: (context: ExtensionContext) => view.render(scoped(extension.id, context)),
    })),
  );

  const withColumns = list.find((extension) => extension.tableColumns);
  const columns = withColumns?.tableColumns;
  const withLogos = list.find((extension) => extension.logos);
  const logos = withLogos?.logos;

  const panel = (slot: "top" | "afterChart" | "end"): ComponentType<ExtensionSlotProps> | undefined => {
    const owners = list.filter((extension) => extension.securityPanel?.[slot]);
    if (!owners.length) return undefined;
    return function SecurityPanels(props: ExtensionSlotProps) {
      return createElement(
        Fragment,
        null,
        owners.map((extension) => createElement(extension.securityPanel![slot]!, { key: extension.id, ...scoped(extension.id, props) })),
      );
    };
  };
  const securityPanel = { top: panel("top"), afterChart: panel("afterChart"), end: panel("end") };

  const withSettings = list.filter((extension) => extension.settingsSection);
  const withDock = list.filter((extension) => extension.dock);
  const withProtection = list.filter((extension) => extension.orderProtection);

  return {
    variantName: list.find((extension) => extension.variantName)?.variantName,
    hasDock: (view) => ownerOf(list, view)?.dock !== undefined,
    useData(context: ExtensionDataContext) {
      const byId: DataById = {};
      for (const extension of list) byId[extension.id] = extension.useData?.(context);
      return byId;
    },
    runtime(data) {
      const merged: ExtensionRuntime = {};
      for (const extension of list) {
        const own = extension.runtime?.(dataOf(extension.id, data));
        if (own) for (const [key, value] of Object.entries(own)) if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
      }
      return merged;
    },
    views: views.length ? views : undefined,
    tableColumns: columns && {
      ...columns,
      records: (data) => columns.records(dataOf(withColumns!.id, data)),
      loading: columns.loading && ((data) => columns.loading!(dataOf(withColumns!.id, data))),
      error: columns.error && ((data) => columns.error!(dataOf(withColumns!.id, data))),
      enabled: columns.enabled && ((data) => columns.enabled!(dataOf(withColumns!.id, data))),
    },
    logos: logos && {
      ...logos,
      useLogos: logos.useLogos && ((context, data) => logos.useLogos!(context, dataOf(withLogos!.id, data))),
    },
    securityPanel: securityPanel.top || securityPanel.afterChart || securityPanel.end ? securityPanel : undefined,
    securityBadge: list.some((extension) => extension.securityBadge)
      ? (record, row) => {
          for (const extension of list) {
            const badge = extension.securityBadge?.(record, row);
            if (badge) return badge;
          }
          return null;
        }
      : undefined,
    dock: withDock.length
      ? function Docks({ context }: { context: ExtensionContext }) {
          const owner = ownerOf(list, context.data.view);
          const Dock = owner?.dock;
          return Dock && owner ? createElement(Dock, { context: scoped(owner.id, context) }) : null;
        }
      : undefined,
    orderProtection: withProtection.length
      ? {
          note: withProtection.map((extension) => extension.orderProtection!.note).join(" "),
          Actions: function ProtectionActions(props: ExtensionOrderProps) {
            return createElement(
              Fragment,
              null,
              withProtection.map((extension) => createElement(extension.orderProtection!.Actions, { key: extension.id, ...props })),
            );
          },
        }
      : undefined,
    settingsSection: withSettings.length
      ? function SettingsSections({ context }: { context: ExtensionContext }) {
          return createElement(
            Fragment,
            null,
            withSettings.map((extension) => createElement(extension.settingsSection!, { key: extension.id, context: scoped(extension.id, context) })),
          );
        }
      : undefined,
    providers: list.some((extension) => extension.providers) ? list.flatMap((extension) => extension.providers ?? []) : undefined,
    palette: (context: ExtensionContext): PaletteItem[] => list.flatMap((extension) => extension.palette?.(scoped(extension.id, context)) ?? []),
    accountMenu: (context: ExtensionContext): (MenuEntry | "divider")[] => list.flatMap((extension) => extension.accountMenu?.(scoped(extension.id, context)) ?? []),
    migrateLegacy(raw) {
      for (const extension of list) extension.migrateLegacy?.(raw);
    },
    prepare: () => Promise.all(list.map((extension) => extension.prepare?.())).then(() => undefined),
  };
}
