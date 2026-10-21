import { useCallback, useEffect, useState } from "react";
import { loadGroupOrder } from "../groups";
import { moveItem } from "../nav";
import { writeStoredJson } from "../storage";

/** The order of the portfolio groups (persisted on this computer; Scalable has no order of its own to change). */
export function useGroupOrder() {
  const [groupOrder, setGroupOrder] = useState<string[]>(loadGroupOrder);

  useEffect(() => {
    writeStoredJson("group-order", groupOrder);
  }, [groupOrder]);

  /** Moves group `from` to the place of group `to` within `ids`, the groups as shown. Ids of groups not loaded now keep their place after them. */
  const moveGroup = useCallback((ids: string[], from: string, to: string) => {
    const next = moveItem(ids, from, to);
    if (next === ids) return;
    setGroupOrder((current) => [...next, ...current.filter((id) => !next.includes(id))]);
  }, []);

  return { groupOrder, moveGroup };
}
