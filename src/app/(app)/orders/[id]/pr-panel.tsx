"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { MAX_PR_NUMBER_LENGTH } from "@/lib/orders";
import type { PrState } from "./pr-actions";

// Phase 8 — the PR is created in the purchasing system; this records its reference against
// the request. The chosen supplier and what was approved are shown alongside, because they
// are what the PR has to be raised for and nobody should have to hold them in their head
// while switching systems.
export function PrPanel({
  orderId,
  supplierName,
  total,
  requiredQuantityG,
  action,
}: {
  orderId: string;
  supplierName: string | null;
  total: string | null;
  requiredQuantityG: string | null;
  action: (prev: PrState, fd: FormData) => Promise<PrState>;
}) {
  const [state, submit, pending] = useActionState(action, undefined);

  return (
    <section className="rounded-lg border border-brand-secondary/40 bg-brand-primary/[0.06] p-5 shadow-elevated">
      <h2 className="text-section-header text-neutral-dark">Raise the PR</h2>
      <p className="text-body mt-1 text-neutral-dark/70">
        The Formulator has approved the costing
        {supplierName ? ` for ${supplierName}` : ""}
        {requiredQuantityG ? `, ${requiredQuantityG} g` : ""}
        {total ? ` at ${total} including shipping` : ""}. Raise the PR in the purchasing
        system and record its reference here.
      </p>

      <form action={submit} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="orderId" value={orderId} />
        <FormField label="PR reference" htmlFor={`pr-${orderId}`}>
          <Input
            id={`pr-${orderId}`}
            name="prNumber"
            maxLength={MAX_PR_NUMBER_LENGTH}
            placeholder="as it appears in the purchasing system"
            className="w-72"
          />
        </FormField>
        <Button type="submit" disabled={pending}>
          {pending ? "Recording…" : "Record PR"}
        </Button>
      </form>

      {state?.error && <p className="text-caption mt-2 text-danger">{state.error}</p>}
      {!state?.error && state?.ok && (
        <p className="text-caption mt-2 text-on-success">{state.ok}</p>
      )}
    </section>
  );
}
