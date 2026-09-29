"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CancelState } from "./cancel-actions";

// Withdrawing a request. Shown only to whoever raised it, and confirmed before it goes:
// cancelling ends the request outright, and the people already working it find out only
// after the fact.
export function CancelPanel({
  orderId,
  statusLabel,
  prNumber,
  action,
}: {
  orderId: string;
  statusLabel: string;
  // A PR already exists in the purchasing system, so cancelling here doesn't cancel that.
  prNumber: string | null;
  action: (prev: CancelState, fd: FormData) => Promise<CancelState>;
}) {
  const [state, submit, pending] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [asking, setAsking] = useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!confirmed) {
      event.preventDefault();
      setAsking(true);
    }
  }

  return (
    <section className="rounded-lg border border-neutral-dark/15 bg-neutral-dark/[0.02] p-5">
      <h2 className="text-section-header text-neutral-dark">Cancel this request</h2>
      <p className="text-body mt-1 text-neutral-dark/70">
        It is currently {statusLabel.toLowerCase()}. Cancelling ends it, and whoever is
        working on it is told.
        {prNumber
          ? ` ${prNumber} has already been raised in the purchasing system — cancelling here does not cancel it there.`
          : ""}
      </p>

      <form ref={formRef} action={submit} onSubmit={handleSubmit} className="mt-3">
        <input type="hidden" name="orderId" value={orderId} />
        {/* Carried outside the dialog, which unmounts on confirm — an input living inside
            it would be gone by the time the form submits. */}
        <input type="hidden" name="cancellationReason" value={reason} />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Cancelling…" : "Cancel request"}
        </Button>
      </form>

      {state?.error && <p className="text-caption mt-2 text-danger">{state.error}</p>}
      {!state?.error && state?.ok && (
        <p className="text-caption mt-2 text-on-success">{state.ok}</p>
      )}

      {asking && (
        <ConfirmDialog
          title="Cancel this request?"
          body="This ends the request. It can't be reopened — a new one would have to be raised."
          detail={
            prNumber
              ? `${prNumber} is already with purchasing and has to be cancelled there separately.`
              : undefined
          }
          confirmLabel="Cancel the request"
          reasonLabel="Why is it being cancelled?"
          reasonPlaceholder="e.g. the project was dropped"
          reasonValue={reason}
          reasonRequired
          onReasonChange={setReason}
          onConfirm={() => {
            setConfirmed(true);
            setAsking(false);
            // Re-submitted on the next tick, so the reason is in the hidden field before
            // the form goes.
            setTimeout(() => formRef.current?.requestSubmit(), 0);
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </section>
  );
}
