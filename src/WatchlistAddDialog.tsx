import { useCallback, useState } from "react";
import { TOOL } from "./commands";
import { SecurityPicker } from "./SecurityPicker";
import type { SecurityHit } from "./OrderDialog";
import { parseSearch } from "./screener";
import type { Common } from "./types";
import { Alert, btn, DialogFooter, field, ModalFrame, ModalTitle, MODAL_TEXT } from "./ui";

export function WatchlistAddDialog({ common, watched, held, onClose }: { common: Common; watched: Set<string>; held: ReadonlySet<string>; onClose: () => void }) {
  const [security, setSecurity] = useState<SecurityHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const showError = useCallback((message: string) => setError(message), []);
  const onWatchlist = security !== null && watched.has(security.isin);
  const inPortfolio = security !== null && held.has(security.isin);

  async function add() {
    if (!security || onWatchlist || inPortfolio || busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await common.actions.run(TOOL.addWatchlistItem, { isin: security.isin }, { done: `${security.name} added to your watchlist` });
      if (outcome?.ok) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalFrame onClose={onClose}>
      <ModalTitle>Add to watchlist</ModalTitle>
      <p className={`mb-4 ${MODAL_TEXT}`}>Search for a Scalable security to add to your watchlist.</p>
      <SecurityPicker security={security} onChange={setSecurity} invoke={common.invoke} parseSearch={parseSearch} onError={showError} />
      {error && <Alert>{error}</Alert>}
      {onWatchlist && <p className={`${field.note} mb-3`}>This security is already on your watchlist.</p>}
      {inPortfolio && <p className={`${field.note} mb-3`}>This security is already in your portfolio.</p>}
      <DialogFooter>
        <button className={btn.secondary} type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className={btn.primary} type="button" onClick={() => void add()} disabled={busy || !security || onWatchlist || inPortfolio}>
          {busy ? "Adding…" : "Add to watchlist"}
        </button>
      </DialogFooter>
    </ModalFrame>
  );
}
