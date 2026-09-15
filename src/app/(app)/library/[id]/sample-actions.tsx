"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Textarea } from "@/components/ui/input";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

type ActionState = { fieldErrors?: Record<string, string>; formError?: string } | undefined;

export function SampleActions({
  sampleId,
  isDiscarded,
  canDelete,
  blockedReason,
  discardAction,
  restoreAction,
  deleteAction,
}: {
  sampleId: string;
  isDiscarded: boolean;
  canDelete: boolean;
  blockedReason: string | null;
  discardAction: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  restoreAction: (id: string) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
}) {
  const [showDiscard, setShowDiscard] = useState(false);
  const [state, formAction, pending] = useActionState(discardAction, undefined);

  if (isDiscarded) {
    return (
      <form action={restoreAction.bind(null, sampleId)}>
        <Button type="submit" variant="secondary">
          Restore to library
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {!showDiscard && (
          <Button type="button" variant="secondary" onClick={() => setShowDiscard(true)}>
            Discard sample
          </Button>
        )}

        {canDelete ? (
          <form action={deleteAction.bind(null, sampleId)}>
            <ConfirmSubmitButton
              confirmMessage="Permanently delete this sample? This cannot be undone. Use Discard instead if you want to keep its history."
              className="text-body rounded-lg border border-danger/30 px-4 py-2 font-medium text-danger transition-colors hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
            >
              Delete permanently
            </ConfirmSubmitButton>
          </form>
        ) : (
          <span className="text-caption text-neutral-dark/50" title={blockedReason ?? undefined}>
            {blockedReason}
          </span>
        )}
      </div>

      {showDiscard && (
        <form
          action={formAction}
          className="rounded-lg border border-neutral-dark/10 bg-white p-4 shadow-elevated"
        >
          <input type="hidden" name="id" value={sampleId} />
          <FormField label="Reason for discarding" htmlFor="reason" error={state?.fieldErrors?.reason}>
            <Textarea
              id="reason"
              name="reason"
              rows={3}
              placeholder="e.g. Expired, contaminated, or fully consumed"
              invalid={Boolean(state?.fieldErrors?.reason)}
            />
          </FormField>
          {state?.formError && <p className="text-caption mt-2 text-danger">{state.formError}</p>}
          <div className="mt-3 flex items-center gap-3">
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? "Discarding…" : "Confirm discard"}
            </Button>
            <button
              type="button"
              onClick={() => setShowDiscard(false)}
              className="text-body font-medium text-neutral-dark/60 hover:underline"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
