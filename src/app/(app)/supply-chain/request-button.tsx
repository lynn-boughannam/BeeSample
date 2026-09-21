"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { DocumentRequestState } from "./actions";

// Phase 2 — one button per supplier that still needs its documents chased.
export function RequestDocumentsButton({
  orderSupplierId,
  supplierName,
  action,
}: {
  orderSupplierId: string;
  supplierName: string;
  action: (prev: DocumentRequestState, fd: FormData) => Promise<DocumentRequestState>;
}) {
  const [state, submit, pending] = useActionState(action, undefined);

  return (
    <form action={submit} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="orderSupplierId" value={orderSupplierId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Recording…" : "Log document request"}
      </Button>
      <span className="sr-only">for {supplierName}</span>
      {state?.error && <span className="text-caption text-danger">{state.error}</span>}
    </form>
  );
}
