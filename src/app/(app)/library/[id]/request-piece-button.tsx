"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { PieceRequestState } from "../../requests/actions";

// What a Formulator can do with one piece: ask for it, withdraw their own request, or read
// why neither is on offer.
//
// The unavailable case says who has it or who asked first rather than disabling the row
// silently — "you can't have this" with no reason is the thing people come and ask about.
export function RequestPieceButton({
  pieceId,
  pieceIndex,
  unavailableReason,
  myRequestId,
  requestAction,
  cancelAction,
}: {
  pieceId: string;
  pieceIndex: number;
  unavailableReason: string | null;
  myRequestId: string | null;
  requestAction: (prev: PieceRequestState, fd: FormData) => Promise<PieceRequestState>;
  cancelAction: (prev: PieceRequestState, fd: FormData) => Promise<PieceRequestState>;
}) {
  const [askState, ask, asking] = useActionState(requestAction, undefined);
  const [dropState, drop, dropping] = useActionState(cancelAction, undefined);

  const state = askState ?? dropState;

  // Their own pending request: the only thing to offer is withdrawing it.
  if (myRequestId) {
    return (
      <div className="text-right">
        <form action={drop}>
          <input type="hidden" name="requestId" value={myRequestId} />
          <Button type="submit" variant="secondary" disabled={dropping}>
            {dropping ? "Cancelling…" : "Cancel request"}
          </Button>
        </form>
        <p className="text-caption mt-1 text-neutral-dark/55">You asked for this piece</p>
        {state?.error && <p className="text-caption mt-1 text-danger">{state.error}</p>}
      </div>
    );
  }

  if (unavailableReason) {
    return (
      <span className="text-caption text-neutral-dark/50">{unavailableReason}</span>
    );
  }

  return (
    <div className="text-right">
      <form action={ask}>
        <input type="hidden" name="pieceId" value={pieceId} />
        <Button type="submit" variant="secondary" disabled={asking}>
          {asking ? "Asking…" : `Request #${pieceIndex}`}
        </Button>
      </form>
      {state?.error && <p className="text-caption mt-1 text-danger">{state.error}</p>}
      {!state?.error && state?.ok && (
        <p className="text-caption mt-1 text-on-success">{state.ok}</p>
      )}
    </div>
  );
}
