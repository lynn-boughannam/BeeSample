"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DIRECTOR_ATTESTATION } from "@/lib/orders";
import type { CostingApprovalState } from "./costing-approval-actions";

// Phase 7 — the Formulator reads what the chosen supplier will cost and approves it.
//
// The costing is laid out here rather than left to be found further up the page: approving
// is signing for these figures, so they belong next to the button that does it. The total
// is shown because cost and shipping are approved together and nobody should have to add
// them up to know what they are agreeing to.
export function CostingApprovalPanel({
  orderId,
  supplierName,
  cost,
  shippingCost,
  requiredQuantityG,
  action,
  rejectAction,
}: {
  orderId: string;
  supplierName: string;
  cost: string;
  shippingCost: string;
  requiredQuantityG: string | null;
  action: (prev: CostingApprovalState, fd: FormData) => Promise<CostingApprovalState>;
  rejectAction: (prev: CostingApprovalState, fd: FormData) => Promise<CostingApprovalState>;
}) {
  const [state, submit, pending] = useActionState(action, undefined);
  const [rejectState, reject, rejecting] = useActionState(rejectAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const rejectRef = useRef<HTMLFormElement>(null);
  const [attested, setAttested] = useState(false);
  const [showAttestation, setShowAttestation] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmedReject, setConfirmedReject] = useState(false);
  const [askingReject, setAskingReject] = useState(false);

  // Rejecting asks for a reason before it goes. Supply Chain has to act on it, and "too
  // dear" and "you priced the wrong quantity" need different work from them.
  function handleReject(event: React.FormEvent<HTMLFormElement>) {
    if (!confirmedReject) {
      event.preventDefault();
      setAskingReject(true);
    }
  }

  // The dialog is the gate. Approval is held back until it has been acknowledged, and the
  // action refuses the attestation field's absence regardless — this only decides when the
  // question is asked, never whether it can be skipped.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!attested) {
      event.preventDefault();
      setShowAttestation(true);
    }
  }

  const total = Number(cost) + Number(shippingCost);

  return (
    <section className="rounded-lg border border-brand-secondary/40 bg-brand-primary/[0.06] p-5 shadow-elevated">
      <h2 className="text-section-header text-neutral-dark">Approve the costing</h2>
      <p className="text-body mt-1 text-neutral-dark/70">
        Supply Chain has costed {supplierName}
        {requiredQuantityG ? ` for ${requiredQuantityG} g` : ""}. Approving releases the
        request for a purchase requisition.
      </p>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
        <Figure label="Cost" value={cost} />
        <Figure label="Shipping" value={shippingCost} />
        <Figure label="Total" value={Number.isFinite(total) ? total.toFixed(2) : "—"} strong />
      </dl>

      <form ref={formRef} action={submit} onSubmit={handleSubmit} className="mt-4">
        <input type="hidden" name="orderId" value={orderId} />
        {/* Only ever posted once the attestation has actually been confirmed. */}
        {attested && <input type="hidden" name="directorApprovalConfirmed" value="on" />}
        <Button type="submit" disabled={pending || rejecting}>
          {pending ? "Approving…" : "Approve costing"}
        </Button>
      </form>

      {/* Its own form, a sibling rather than nested — and the quieter of the two, because
          sending work back is the exception. */}
      <form ref={rejectRef} action={reject} onSubmit={handleReject} className="mt-2">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="costingRejectionReason" value={reason} />
        <Button type="submit" variant="secondary" disabled={pending || rejecting}>
          {rejecting ? "Sending back…" : "Reject costing"}
        </Button>
      </form>

      {(state?.error ?? rejectState?.error) && (
        <p className="text-caption mt-2 text-danger">{state?.error ?? rejectState?.error}</p>
      )}
      {!state?.error && !rejectState?.error && (state?.ok ?? rejectState?.ok) && (
        <p className="text-caption mt-2 text-on-success">{state?.ok ?? rejectState?.ok}</p>
      )}

      {askingReject && (
        <ConfirmDialog
          title="Send this costing back?"
          body="Supply Chain will be asked to work it out again. The request stays open — cancel it instead if it is no longer wanted."
          detail={`${supplierName} · ${Number.isFinite(total) ? total.toFixed(2) : "—"} including shipping.`}
          confirmLabel="Send it back"
          reasonLabel="What is wrong with it?"
          reasonPlaceholder="e.g. the price is above budget for this quantity"
          reasonValue={reason}
          reasonRequired
          onReasonChange={setReason}
          onConfirm={() => {
            setConfirmedReject(true);
            setAskingReject(false);
            // Next tick, so the reason is in the hidden field before the form goes.
            setTimeout(() => rejectRef.current?.requestSubmit(), 0);
          }}
          onCancel={() => setAskingReject(false)}
        />
      )}

      {showAttestation && (
        <ConfirmDialog
          title="Director approval"
          body={DIRECTOR_ATTESTATION}
          detail={`${supplierName} · ${Number.isFinite(total) ? total.toFixed(2) : "—"} including shipping.`}
          confirmLabel="I confirm"
          onConfirm={() => {
            setAttested(true);
            setShowAttestation(false);
            // Re-submitted on the next tick, so the hidden field the action requires is
            // rendered before the form goes.
            setTimeout(() => formRef.current?.requestSubmit(), 0);
          }}
          onCancel={() => setShowAttestation(false)}
        />
      )}
    </section>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-caption text-neutral-dark/55">{label}</dt>
      <dd
        className={`tabular-nums text-neutral-dark ${
          strong ? "text-section-header" : "text-body"
        }`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}
