import { useCallback, useReducer } from "react";
import { INITIAL_STATUSES, reduceProviderStatus, type Provider } from "../providerStatus";

/** The status of the configured providers, kept in memory for the session; nothing is stored. */
export function useProviderStatus(extraProviders: readonly Provider[] = []) {
  const [statuses, dispatch] = useReducer(reduceProviderStatus, extraProviders, (providers) => ({
    ...INITIAL_STATUSES,
    ...Object.fromEntries(providers.map((provider) => [provider, INITIAL_STATUSES.scalable])),
  }));
  const succeeded = useCallback((provider: Provider) => dispatch({ type: "success", provider, at: Date.now() }), []);
  const failed = useCallback((provider: Provider, message: string) => dispatch({ type: "failure", provider, message }), []);
  return { statuses, succeeded, failed };
}
