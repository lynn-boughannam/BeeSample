"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DocumentUploadState } from "./actions";

// Phase 3 — handing one supplier to CSS. Confirmed rather than one-click, because it is
// the point after which the documents and pricing can't be changed.
export function SubmitToCssButton({
  orderSupplierId,
  supplierName,
  action,
}: {
  orderSupplierId: string;
  supplierName: string;
  action: (prev: DocumentUploadState, fd: FormData) => Promise<DocumentUploadState>;
}) {
  const [state, submit, pending] = useActionState(action, undefined);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="mt-3">
        <Button type="button" onClick={() => setConfirming(true)}>
          Send to CSS
        </Button>
        {state?.error && <p className="text-caption mt-2 text-danger">{state.error}</p>}
      </div>
    );
  }

  return (
    <form action={submit} className="mt-3 flex flex-wrap items-center gap-3">
      <input type="hidden" name="orderSupplierId" value={orderSupplierId} />
      <p className="text-caption text-neutral-dark/70">
        Send {supplierName} to CSS? Its documents and pricing can&apos;t be changed after this.
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Yes, send to CSS"}
      </Button>
      <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      {state?.error && <span className="text-caption text-danger">{state.error}</span>}
    </form>
  );
}
