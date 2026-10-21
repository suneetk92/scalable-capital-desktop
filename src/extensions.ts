import type { ComponentType, ReactNode, SVGProps } from "react";
import type { DrawerTarget } from "./SecurityDrawer";
import type { MarketRecord, TableColumn } from "./marketColumns";
import type { NavId, View } from "./nav";
import type { Settings } from "./settings";
import type { SecurityGroup } from "./groups";
import type { ScreenerRow } from "./screener";
import type { Invoke } from "./tools";
import type { Common, Dashboard } from "./types";
import type { AppCommands } from "./app/useAppCommands";
import type { AppData } from "./app/useAppData";
import type { PaletteItem } from "./CommandPalette";
import type { MenuEntry } from "./controls";
import extensionModule from "virtual:app-extension";

export type ExtensionData = unknown;

export type ExtensionRuntime = {
  pageData?: unknown;
  loading?: boolean;
  error?: string | null;
  tableLoading?: boolean;
  tableError?: string | null;
  enabled?: boolean;
  busy?: boolean;
  refreshLabel?: string | null;
  refresh?(): void;
  toggleAutoRefresh?(): void;
  autoRefresh?: boolean;
  logos?: ReadonlyMap<string, string>;
  isinLogos?: ReadonlyMap<string, string>;
};

export type ExtensionDataContext = {
  dashboard: Dashboard | null;
  portfolioRows: ScreenerRow[];
  watchlistRows: ScreenerRow[];
  groups: SecurityGroup[];
  settings: Settings;
  view: View;
  reloadKey: number;
  invoke: Invoke;
  common: Common;
  signedIn: boolean;
  securityTarget: DrawerTarget | null;
};

export type ExtensionContext = { data: AppData; commands: AppCommands };

export type ExtensionView = {
  id: NavId;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  after: View;
  render(context: ExtensionContext): ReactNode;
};

export type ExtensionColumnProvider = {
  groups(): { group: string; columns: TableColumn[] }[];
  column(id: string): TableColumn | undefined;
  defaults: string[];
  records(data: ExtensionData): Map<string, MarketRecord>;
  loading?(data: ExtensionData): boolean;
  error?(data: ExtensionData): string | null;
  enabled?(data: ExtensionData): boolean;
  formatCell?(column: TableColumn, record: MarketRecord | undefined, currency: string): { text: string; tone: "" | "up" | "down" | "muted" };
  sortValue?(column: TableColumn, record: MarketRecord | undefined): number | string | null;
  exportValue?(column: TableColumn, record: MarketRecord | undefined): string | number | null;
  renderSettings?(id: string, column: TableColumn, onChange: (values: Record<string, string>) => void): ReactNode;
  updateId?(id: string, column: TableColumn, values: Record<string, string>): string;
  isTextColumn?(column: TableColumn): boolean;
};

export type ExtensionSlotProps = ExtensionContext & { target: DrawerTarget };
export type ExtensionProvider = { id: string; name: string };

export type AppExtension = {
  id: string;
  variantName?: string;
  useData?(context: ExtensionDataContext): ExtensionData;
  runtime?(data: ExtensionData): ExtensionRuntime;
  views?: ExtensionView[];
  tableColumns?: ExtensionColumnProvider;
  logos?: {
    useLogos?(context: ExtensionDataContext, data: ExtensionData): ReadonlyMap<string, string>;
    useIsinLogos?(args: { invoke: Invoke; isins: readonly string[]; enabled: boolean }): ReadonlyMap<string, string>;
    logoOf?(record: MarketRecord | undefined, isin: string | undefined, byId: ReadonlyMap<string, string>, byIsin: ReadonlyMap<string, string>): string | undefined;
  };
  securityPanel?: Partial<Record<"top" | "afterChart" | "end", ComponentType<ExtensionSlotProps>>>;
  securityBadge?(record: MarketRecord | undefined, row: ScreenerRow): { label: string; title: string } | null;
  dock?: ComponentType<{ context: ExtensionContext }>;
  settingsSection?: ComponentType<{ context: ExtensionContext }>;
  providers?: ExtensionProvider[];
  palette?(context: ExtensionContext): PaletteItem[];
  accountMenu?(context: ExtensionContext): (MenuEntry | "divider")[];
  migrateLegacy?(raw: Record<string, unknown>): void;
  prepare?(): Promise<void>;
};

// Shared building blocks that only extensions use.
export { MenuRowButton } from "./controls";
export { formatWithOptions } from "./format";
export { TONE_CLASS } from "./ScreenerRow";

const extension: AppExtension = extensionModule;

export { extension };

const NO_LOGOS: ReadonlyMap<string, string> = new Map();

export function useExtensionIsinLogos(args: { invoke: Invoke; isins: readonly string[]; enabled: boolean }): ReadonlyMap<string, string> {
  return extension.logos?.useIsinLogos?.(args) ?? NO_LOGOS;
}
