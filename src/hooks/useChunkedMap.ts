import { useEffect, useMemo, useState } from "react";
import { CHUNK_SIZE, mapChunked } from "../chunked";

/**
 * `items.map(map)` that does not block the UI for a long list: up to one slice it is worked out at once, beyond that
 * in slices with a pause between them. The previous result stays in place until the new one is ready. `map` must be
 * stable (declare it outside the component).
 */
export function useChunkedMap<T, R>(items: T[], map: (item: T) => R): { items: R[]; busy: boolean } {
  const small = items.length <= CHUNK_SIZE;
  const direct = useMemo(() => (small ? items.map(map) : null), [items, small, map]);
  const [slow, setSlow] = useState<{ source: T[]; out: R[] }>({ source: [], out: [] });

  useEffect(() => {
    if (small) return;
    let stale = false;
    void mapChunked(items, map, { cancelled: () => stale }).then((out) => {
      if (out) setSlow({ source: items, out });
    });
    return () => {
      stale = true;
    };
  }, [items, small, map]);

  return { items: direct ?? slow.out, busy: !small && slow.source !== items };
}
