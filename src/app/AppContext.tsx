import { createContext, useContext, type ReactNode } from "react";
import type { AppCommands } from "./useAppCommands";
import type { AppData } from "./useAppData";

type AppContextValue = { data: AppData; commands: AppCommands };

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ data, commands, children }: AppContextValue & { children: ReactNode }) {
  return <AppContext.Provider value={{ data, commands }}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("App state is unavailable outside AppProvider.");
  return context;
}

/** When the account data was last loaded; null before the first load or outside the provider. */
export function useLastUpdated() {
  return useContext(AppContext)?.data.lastUpdated ?? null;
}
