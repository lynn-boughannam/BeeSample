"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import type { DocumentUploadState } from "./actions";

// Phase 3 — what this supplier quoted. Both fields together are what CSS compares, so the
// form asks for them together rather than letting one be saved without the other.
export function PricingForm({
  orderSupplierId,
  landedPrice,
  moq,
  action,
}: {
  orderSupplierId: string;
  landedPrice: string;
  moq: string;
  action: (prev: DocumentUploadState, fd: FormData) => Promise<DocumentUploadState>;
}) {
  const [state, submit, pending] = useActionState(action, undefined);

  return (
    <form action={submit} className="mt-3 flex flex-wrap items-end gap-3">
      <input type="hidden" name="orderSupplierId" value={orderSupplierId} />
      <FormField label="Landed price" htmlFor={`price-${orderSupplierId}`}>
        <Input
          id={`price-${orderSupplierId}`}
          name="landedPrice"
          type="number"
          step="0.01"
          min="0"
          defaultValue={landedPrice}
          className="w-36"
        />
      </FormField>
      <FormField label="MOQ" htmlFor={`moq-${orderSupplierId}`}>
        <Input
          id={`moq-${orderSupplierId}`}
          name="moq"
          defaultValue={moq}
          placeholder="e.g. 25 kg"
          className="w-40"
        />
      </FormField>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save price & MOQ"}
      </Button>
      {state?.error && <span className="text-caption pb-2 text-danger">{state.error}</span>}
      {!state?.error && state?.ok && (
        <span className="text-caption pb-2 text-on-success">{state.ok}</span>
      )}
    </form>
  );
}
