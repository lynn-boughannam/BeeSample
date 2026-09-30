"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { PieceRequestState } from "./actions";

// The Admin's two answers to one request. Give is the primary act; rejecting asks why first,
// because the formulator reads that reason and otherwise just asks again for the same piece.
export function DecideButtons({
  requestId,
  formulatorName,
  pieceLabel,
  giveAction,
  rejectAction,
}: {
  requestId: string;
  formulatorName: string;
  pieceLabel: string;
  giveAction: (prev: PieceRequestState, fd: FormData) => Promise<PieceRequestState>;
  rejectAction: (prev: PieceRequestState, fd: FormData) => Promise<PieceRequestState>;
}) {
  const [giveState, give, giving] = useActionState(giveAction, undefined);
  const [rejectState, reject, rejecting] = useActionState(rejectAction, undefined);
  const rejectRef = useRef<HTMLFormElement>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [asking, setAsking] = useState(false);

  function handleReject(event: React.FormEvent<HTMLFormElement>) {
    if (!confirmed) {
      event.preventDefault();
      setAsking(true);
    }
  }

  const busy = giving || rejecting;
  const error = giveState?.error ?? rejectState?.error;
  const ok = !error ? (giveState?.ok ?? rejectState?.ok) : undefined;

  return (
    <div>
      {/* Two sibling forms, never nested — a form inside a form is invalid markup. */}
      <div className="flex flex-wrap items-center gap-2">
        <form action={give}>
          <input type="hidden" name="requestId" value={requestId} />
          <Button type="submit" disabled={busy}>
            {giving ? "Giving…" : "Give"}
          </Button>
        </form>
        <form ref={rejectRef} action={reject} onSubmit={handleReject}>
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="rejectionReason" value={reason} />
          <Button type="submit" variant="secondary" disabled={busy}>
            {rejecting ? "Rejecting…" : "Reject"}
          </Button>
        </form>
      </div>

      {error && <p className="text-caption mt-1.5 text-danger">{error}</p>}
      {ok && <p className="text-caption mt-1.5 text-on-success">{ok}</p>}

      {asking && (
        <ConfirmDialog
          title="Reject this request?"
          body={`${formulatorName} asked for ${pieceLabel}. They will see the reason you give.`}
          confirmLabel="Reject it"
          reasonLabel="Why can't they have it?"
          reasonPlaceholder="e.g. reserved for the stability trial"
          reasonValue={reason}
          reasonRequired
          onReasonChange={setReason}
          onConfirm={() => {
            setConfirmed(true);
            setAsking(false);
            // Next tick, so the reason is in the hidden field before the form goes.
            setTimeout(() => rejectRef.current?.requestSubmit(), 0);
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}
