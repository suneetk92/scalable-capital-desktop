import { useCallback, useEffect, useState } from "react";

export function useAsyncQuery<T>(load: () => Promise<T>, dependencies: readonly unknown[], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let active = true;
    setData(null);
    setError(null);
    setLoading(true);
    load()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((failure: unknown) => {
        if (active) setError(typeof failure === "string" ? failure : failure instanceof Error ? failure.message : "Could not load this data.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // The caller provides the dependency values that determine the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, enabled, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { data, error, loading, retry };
}
