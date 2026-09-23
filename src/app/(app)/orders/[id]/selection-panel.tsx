"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Input, Textarea } from "@/components/ui/input";
import type { SelectionState } from "./selection-actions";

export type SelectableSupplier = {
  id: string;
  position: number;
  supplierName: string;
  landedPrice: string | null;
  moq: string | null;
  documentCount: number;
};

// Phase 5 — the Formulator either chooses one of the options CSS approved, or declines them
// all. Both are the same decision, so both live here: CSS approving the documents says the
// paperwork is in order, not that the terms are worth accepting.
//
// Radio buttons rather than a button per row, because this is one choice between
// alternatives — the terms sit next to each other to be compared before committing.
export function SelectionPanel({
  orderId,
  suppliers,
  requiredQuantityG,
  selectAction,
  declineAction,
}: {
  orderId: string;
  suppliers: SelectableSupplier[];
  requiredQuantityG: string;
  selectAction: (prev: SelectionState, fd: FormData) => Promise<SelectionState>;
  declineAction: (prev: SelectionState, fd: FormData) => Promise<SelectionState>;
}) {
  const [selectState, select, selecting] = useActionState(selectAction, undefined);
  const [declineState, decline, declining] = useActionState(declineAction, undefined);
  // Pre-selected when there is only one survivor: the choice is still explicit, but it
  // doesn't make someone tick the only box on offer.
  const [chosen, setChosen] = useState(suppliers.length === 1 ? suppliers[0].id : "");
  const [showDecline, setShowDecline] = useState(false);
  const [reason, setReason] = useState("");

  const error = selectState?.error ?? declineState?.error;
  const ok = selectState?.ok ?? declineState?.ok;
  const busy = selecting || declining;

  return (
    <section className="rounded-lg border border-brand-secondary/30 bg-brand-primary/[0.06] p-5">
      <h2 className="text-section-header text-neutral-dark">Choose a supplier</h2>
      <p className="text-caption mt-0.5 mb-4 text-neutral-dark/70">
        {suppliers.length === 1
          ? "One option passed document review."
          : `${suppliers.length} options passed document review.`}{" "}
        Their documents are in order — whether the terms work is yours to judge.
        {requiredQuantityG && (
          <>
            {" "}
            You asked for <strong className="font-semibold">{requiredQuantityG} g</strong>; check
            that against each MOQ below.
          </>
        )}
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

      <form action={select}>
        <input type="hidden" name="orderId" value={orderId} />

        <ul className="space-y-2">
          {suppliers.map((s) => (
            <li key={s.id}>
              <label
                className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-3 transition-colors duration-150 ${
                  chosen === s.id
                    ? "border-brand-secondary bg-white"
                    : "border-neutral-dark/15 hover:bg-white/60"
                }`}
              >
                <input
                  type="radio"
                  name="orderSupplierId"
                  value={s.id}
                  checked={chosen === s.id}
                  onChange={() => setChosen(s.id)}
                  className="accent-brand-secondary"
                />
                <span className="text-caption text-neutral-dark/45">#{s.position}</span>
                <span className="text-body font-medium text-neutral-dark">{s.supplierName}</span>
                <span className="text-caption text-neutral-dark/70">{s.landedPrice ?? "—"}</span>
                {/* MOQ is often the reason a request is declined, so it is called out
                    rather than buried in a run of figures. */}
                <span className="text-body font-medium text-neutral-dark">
                  MOQ {s.moq || "—"}
                </span>
                <span className="text-caption ml-auto text-neutral-dark/50">
                  {s.documentCount} document{s.documentCount === 1 ? "" : "s"}
                </span>
              </label>
            </li>
          ))}
        </ul>

        {/* Correcting the quantity is part of committing to a supplier: an MOQ may not
            match what was originally asked for. */}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <FormField label="Required quantity (g)" htmlFor={`qty-${orderId}`}>
            <Input
              id={`qty-${orderId}`}
              name="requiredQuantityG"
              type="number"
              step="0.01"
              min="0"
              defaultValue={requiredQuantityG}
              className="w-40"
            />
          </FormField>
          <Button type="submit" disabled={busy || chosen === ""}>
            {selecting ? "Recording…" : "Confirm supplier"}
          </Button>
          {chosen === "" && (
            <span className="text-caption pb-2 text-neutral-dark/55">
              Pick an option to continue.
            </span>
          )}
        </div>
      </form>

      <div className="mt-4 border-t border-neutral-dark/10 pt-4">
        {!showDecline ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => setShowDecline(true)}
          >
            None of these work
          </Button>
        ) : (
          <form action={decline} className="space-y-3">
            <input type="hidden" name="orderId" value={orderId} />
            <p className="text-caption text-neutral-dark/70">
              This ends the request. Nothing will be ordered.
            </p>
            {/* Required: Supply Chain sourced these, and "no" without a reason is an
                instruction to source the same ones again. */}
            <FormField label="Why don't these work?" htmlFor={`decline-${orderId}`}>
              <Textarea
                id={`decline-${orderId}`}
                name="declineReason"
                rows={2}
                autoFocus
                placeholder="e.g. the MOQ is far above what we need for a trial"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={declining || reason.trim() === ""}>
                {declining ? "Declining…" : "Confirm decline"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowDecline(false)}>
                Cancel
              </Button>
              {reason.trim() === "" && (
                <span className="text-caption text-neutral-dark/55">A reason is needed.</span>
              )}
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
