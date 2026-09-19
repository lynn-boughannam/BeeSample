"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Textarea } from "@/components/ui/input";
import type { ReviewState } from "./review-actions";

// Phase 1 — the Admin's decision on a submitted request. Only rendered when the request is
// actually awaiting review; the server checks again regardless.
export function ReviewPanel({
  orderId,
  canEdit,
  approveAction,
  rejectAction,
}: {
  orderId: string;
  canEdit: boolean;
  approveAction: (prev: ReviewState, fd: FormData) => Promise<ReviewState>;
  rejectAction: (prev: ReviewState, fd: FormData) => Promise<ReviewState>;
}) {
  const [approveState, approve, approving] = useActionState(approveAction, undefined);
  const [rejectState, reject, rejecting] = useActionState(rejectAction, undefined);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const error = approveState?.error ?? rejectState?.error;
  const ok = approveState?.ok ?? rejectState?.ok;

  return (
    <section className="rounded-lg border border-brand-secondary/30 bg-brand-primary/[0.06] p-5">
      <h2 className="text-section-header text-neutral-dark">Review</h2>
      <p className="text-caption mt-0.5 mb-4 text-neutral-dark/70">
        Approving hands this request to Supply Chain. Rejecting ends it — nothing further
        can be done to a rejected request.
      </p>

      {error && (
        <p className="text-body mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
          {error}
        </p>
      )}
      {ok && !error && (
        <p className="text-body mb-3 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-on-success">
          {ok}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <form action={approve}>
          <input type="hidden" name="orderId" value={orderId} />
          <Button type="submit" disabled={approving || rejecting}>
            {approving ? "Approving…" : "Approve"}
          </Button>
        </form>

        <Button
          type="button"
          variant="secondary"
          disabled={approving || rejecting}
          onClick={() => setShowReject((v) => !v)}
        >
          {showReject ? "Cancel" : "Reject"}
        </Button>

        {canEdit && (
          <Link
            href={`/orders/${orderId}/edit`}
            className="text-body text-neutral-dark/70 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
          >
            Edit request
          </Link>
        )}
      </div>

      {showReject && (
        <form action={reject} className="mt-4 max-w-xl">
          <input type="hidden" name="orderId" value={orderId} />
          {/* Required: a rejection the requester can't understand is one they'll raise
              again unchanged. */}
          <FormField label="Why is this being rejected?" htmlFor="rejectionReason">
            <Textarea
              id="rejectionReason"
              name="rejectionReason"
              rows={3}
              autoFocus
              value={reason}
              placeholder="e.g. already held in the library, or the quantity is unrealistic"
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={rejecting || reason.trim() === ""}>
              {rejecting ? "Rejecting…" : "Confirm rejection"}
            </Button>
            {reason.trim() === "" && (
              <span className="text-caption text-neutral-dark/55">
                A reason is needed before this can be rejected.
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
