import type { AccessMode } from "./types";

/** The three access levels, matching Scalable's MCP access: read-only, limited ("Restricted") and full. */
export const ACCESS_MODES: { mode: AccessMode; label: string; command: string; title: string }[] = [
  { mode: "readonly", label: "Read-only", command: "Switch to read-only mode", title: "Read-only. Nothing in your account can be changed." },
  {
    mode: "restricted",
    label: "Restricted",
    command: "Switch to restricted access",
    title: "Restricted access. Change watchlists, price alerts, portfolio groups and trailing stops, at any hour. No orders or savings plans.",
  },
  {
    mode: "full",
    label: "Full",
    command: "Enable full access",
    title: "Full access, while the exchange is open. Place orders and change savings plans; every order still needs a preview and your confirmation.",
  },
];
