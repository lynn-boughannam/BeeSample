"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { PieceRequestState } from "./actions";

// A requester withdrawing their own request. No confirmation dialog: nothing has moved yet,
// and asking again is free — a prompt here would be ceremony for an act with no consequence.
export function CancelRequestButton({
  requestId,
  action,
}: {
  requestId: string;
  action: (prev: PieceRequestState, fd: FormData) => Promise<PieceRequestState>;
}) {
  const [state, submit, pending] = useActionState(action, undefined);

  return (
    <div>
      <form action={submit}>
        <input type="hidden" name="requestId" value={requestId} />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Cancelling…" : "Cancel"}
        </Button>
      </form>
      {state?.error && <p className="text-caption mt-1.5 text-danger">{state.error}</p>}
      {!state?.error && state?.ok && (
        <p className="text-caption mt-1.5 text-on-success">{state.ok}</p>
      )}
    </div>
  );
}
