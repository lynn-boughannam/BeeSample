"use client";

import { Button } from "@/components/ui/button";
import { FormField, Textarea } from "@/components/ui/input";

// The confirmation the request workflow asks for before an act someone is signing their
// name to: raising a request with fewer than three suppliers, attesting Director approval
// on submission (SLT-58), and approving the costing at the end.
//
// Shared rather than copied, so an attestation cannot come to mean one thing on one screen
// and something slightly different on another.

export function ConfirmDialog({
  title,
  body,
  detail,
  confirmLabel,
  reasonLabel,
  reasonPlaceholder,
  reasonValue,
  reasonRequired,
  onReasonChange,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  detail?: string;
  confirmLabel: string;
  // Optional: only the supplier prompt asks for an explanation. Left optional rather than
  // required because the acknowledgement is the gate — this is the context procurement
  // would otherwise have to chase by email.
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonValue?: string;
  // Confirming is blocked until it's filled in — procurement acts on this, so an empty
  // one would just move the question to an email.
  reasonRequired?: boolean;
  onReasonChange?: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const blockedOnReason = Boolean(reasonRequired) && (reasonValue ?? "").trim() === "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-dark/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h3 className="text-section-header text-neutral-dark">{title}</h3>
        <p className="text-body mt-2 text-neutral-dark/80">{body}</p>
        {detail && <p className="text-caption mt-1 text-neutral-dark/55">{detail}</p>}
        {reasonLabel && onReasonChange && (
          <div className="mt-3">
            <FormField label={reasonLabel} htmlFor="shortListReason">
              <Textarea
                id="shortListReason"
                rows={2}
                autoFocus
                value={reasonValue ?? ""}
                placeholder={reasonPlaceholder}
                onChange={(e) => onReasonChange(e.target.value)}
              />
            </FormField>
          </div>
        )}
        {blockedOnReason && (
          <p className="text-caption mt-1 text-neutral-dark/55">
            A reason is needed before this can be submitted.
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Go back
          </Button>
          <Button type="button" onClick={onConfirm} disabled={blockedOnReason}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
