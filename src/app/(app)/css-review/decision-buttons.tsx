"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { CssReviewState } from "./actions";

// Phase 4 — one supplier's document decision. Approve is one click; rejecting asks why,
// because an elimination nobody can explain is one Supply Chain will re-source identically
// next time.
export function DecisionButtons({
  orderSupplierId,
  supplierName,
  isLastOption,
  approveAction,
  rejectAction,
}: {
  orderSupplierId: string;
  supplierName: string;
  // True when rejecting this one would leave the request with nothing, which ends it.
  isLastOption: boolean;
  approveAction: (prev: CssReviewState, fd: FormData) => Promise<CssReviewState>;
  rejectAction: (prev: CssReviewState, fd: FormData) => Promise<CssReviewState>;
}) {
  const [approveState, approve, approving] = useActionState(approveAction, undefined);
  const [rejectState, reject, rejecting] = useActionState(rejectAction, undefined);
  const [showReject, setShowReject] = useState(false);
  const [note, setNote] = useState("");

  const error = approveState?.error ?? rejectState?.error;
  const busy = approving || rejecting;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={approve}>
          <input type="hidden" name="orderSupplierId" value={orderSupplierId} />
          <Button type="submit" disabled={busy}>
            {approving ? "Approving…" : "Approve"}
          </Button>
        </form>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => setShowReject((v) => !v)}
        >
          {showReject ? "Cancel" : "Reject"}
        </Button>
      </div>

      {showReject && (
        <form action={reject} className="space-y-2">
          <input type="hidden" name="orderSupplierId" value={orderSupplierId} />
          {isLastOption && (
            <p className="text-caption rounded-md border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-danger">
              This is the last option left. Rejecting it rejects the whole request.
            </p>
          )}
          <Textarea
            name="cssNote"
            rows={2}
            aria-label={`Why ${supplierName} is being rejected`}
            placeholder="e.g. SDS is out of date, or no certificate of analysis supplied"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button type="submit" disabled={rejecting || note.trim() === ""}>
            {rejecting ? "Rejecting…" : "Confirm rejection"}
          </Button>
          {note.trim() === "" && (
            <p className="text-caption text-neutral-dark/55">A reason is needed.</p>
          )}
        </form>
      )}

      {error && <p className="text-caption text-danger">{error}</p>}
    </div>
  );
}
