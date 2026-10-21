import { statusLines, type Provider, type ProviderStatuses } from "../providerStatus";
import { extension } from "../extensions";
import { Badge, btn } from "../ui";

/**
 * One line per service that is not working: the data shown is from the last time it worked ("stale", with the
 * time) or there is none yet ("failed"). Renders nothing while everything works. Retry reloads that service.
 */
export function ProviderStatus({ statuses, busy, onRetry }: { statuses: ProviderStatuses; busy: boolean; onRetry: (provider: Provider) => void }) {
  const lines = statusLines(statuses, Object.fromEntries((extension.providers ?? []).map(({ id, name }) => [id, name])));
  if (lines.length === 0) return null;
  return (
    <ul className="mb-3.5 flex flex-wrap gap-x-4 gap-y-1.5" role="status" aria-label="Data sources">
      {lines.map((line) => (
        <li key={line.provider} className="flex items-center gap-2 text-ink-muted" title={line.detail ?? undefined}>
          <Badge tone={line.state === "stale" ? "yellow" : "red"}>{line.text}</Badge>
          <button className={btn.link} type="button" disabled={busy} onClick={() => onRetry(line.provider)}>
            Retry
          </button>
        </li>
      ))}
    </ul>
  );
}
