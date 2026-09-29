"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import type { DocumentUploadState } from "./actions";

// Phase 6 — what the chosen supplier will actually cost. Shown for one supplier only, which
// is the point of costing after selection rather than before: the other options were never
// going to be ordered.
//
// One button saves and submits. There is a single row to fill in and nothing to weigh it
// against, so holding it back behind a second click would buy nothing.
export function CostingForm({
  orderSupplierId,
  supplierName,
  cost,
  shippingCost,
  requiredQuantityG,
  action,
}: {
  orderSupplierId: string;
  supplierName: string;
  cost: string;
  shippingCost: string;
  // The quantity the Formulator confirmed while choosing, which is what is being costed.
  requiredQuantityG: string | null;
  action: (prev: DocumentUploadState, fd: FormData) => Promise<DocumentUploadState>;
}) {
  const [state, submit, pending] = useActionState(action, undefined);

  return (
    <div className="mt-4 rounded-md border border-brand-secondary/30 bg-brand-primary/[0.06] p-4">
      <p className="text-body font-semibold text-neutral-dark">Costing for {supplierName}</p>
      <p className="text-caption mt-0.5 text-neutral-dark/60">
        The chosen supplier{requiredQuantityG ? `, for ${requiredQuantityG} g` : ""}. Submitting
        sends the request back to the Formulator for approval.
      </p>

      <form action={submit} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="orderSupplierId" value={orderSupplierId} />
        <FormField label="Cost" htmlFor={`cost-${orderSupplierId}`}>
          <Input
            id={`cost-${orderSupplierId}`}
            name="cost"
            type="number"
            step="0.01"
            min="0"
            defaultValue={cost}
            className="w-36"
          />
        </FormField>
        <FormField label="Shipping cost" htmlFor={`shipping-${orderSupplierId}`}>
          <Input
            id={`shipping-${orderSupplierId}`}
            name="shippingCost"
            type="number"
            step="0.01"
            min="0"
            defaultValue={shippingCost}
            className="w-36"
          />
        </FormField>
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit costing"}
        </Button>
      </form>

      {state?.error && <p className="text-caption mt-2 text-danger">{state.error}</p>}
      {!state?.error && state?.ok && (
        <p className="text-caption mt-2 text-on-success">{state.ok}</p>
      )}
    </div>
  );
}
