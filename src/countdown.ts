import { useEffect, useState } from "react";

/** How much of an interval has passed since `startedAt`, from 0 to 1. */
export function elapsedShare(startedAt: number, now: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.max(0, Math.min(1, (now - startedAt) / durationMs));
}

/** The share of the interval since `startedAt` that has passed, updated every second while `active`. */
export function useElapsedShare(startedAt: number | null, durationMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  return startedAt === null ? 0 : elapsedShare(startedAt, now, durationMs);
}
