import { useState } from "react";
import type { PreviewResponse } from "../commands";
import { errorText } from "../tools";
import { reviewOf } from "../previewReviewModel";
import { usePreviewExpiry } from "../PreviewReview";

type PreviewStage = "form" | "preview" | "complete";

export function useBusyAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(action: () => Promise<T>, onSuccess?: (result: T) => void, onFailure?: () => void) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      onSuccess?.(result);
      return result;
    } catch (failure) {
      setError(errorText(failure));
      onFailure?.();
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, setError, run };
}

export function usePreviewFlow() {
  const [stage, setStage] = useState<PreviewStage>("form");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  const action = useBusyAction();
  const review = reviewOf(preview?.preview);
  const expiry = usePreviewExpiry(review.expiresAt);
  const allAccepted = review.acknowledgements.every((acknowledgement) => accepted.includes(acknowledgement.id));

  async function runPreview(createPreview: () => Promise<PreviewResponse>) {
    const response = await action.run(createPreview);
    if (!response) return null;
    setPreview(response);
    setAccepted([]);
    setStage("preview");
    return response;
  }

  async function runSubmit<T>(submit: (previewId: string) => Promise<T>, onSuccess?: (result: T) => void) {
    if (!preview) return null;
    return action.run(
      () => submit(preview.previewId),
      (value) => {
        setResult(value);
        setStage("complete");
        onSuccess?.(value);
      },
      () => setStage("form"),
    );
  }

  function backToForm() {
    setStage("form");
    setPreview(null);
    setAccepted([]);
  }

  function reset() {
    setStage("form");
    setPreview(null);
    setResult(null);
    setAccepted([]);
    action.setError(null);
  }

  return {
    stage,
    setStage,
    preview,
    result,
    accepted,
    setAccepted,
    busy: action.busy,
    error: action.error,
    setError: action.setError,
    review,
    expiry,
    allAccepted,
    runPreview,
    runSubmit,
    backToForm,
    reset,
  };
}
