"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import type { StockActionState } from "../library/[id]/stock-actions";

// Bringing a piece back, from the same page the request was answered on — the Admin who
// handed it over is the one who takes it back, and sending them to the sample page to do it
// was a detour through a screen they didn't need.
//
// Two numbers and a date: how much was used, and when it actually came back. The date
// matters for the same reason it does on a checkout — this gets recorded after the fact, and
// the piece's history should say when the thing happened rather than when it was typed.
export function LogUsageForm({
  pieceId,
  pieceIndex,
  remainingWeightG,
  holderName,
  today,
  action,
}: {
  pieceId: string;
  pieceIndex: number;
  remainingWeightG: string;
  holderName: string;
  // The server's today, so the picker's ceiling matches the date the action validates
  // against and the markup doesn't differ between render and hydration.
  today: string;
  holderNameFallback?: string;
  action: (prev: StockActionState, fd: FormData) => Promise<StockActionState>;
}) {
  const [state, submit, pending] = useActionState(action, undefined);
  const [open, setOpen] = useState(false);
  const errors = state?.fieldErrors ?? {};

  if (!open) {
    return (
      <div className="text-right">
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Log return
        </Button>
        {state?.formError && <p className="text-caption mt-1 text-danger">{state.formError}</p>}
      </div>
    );
  }

  return (
    <form action={submit} className="mt-2 rounded-md border border-neutral-dark/15 p-3">
      <input type="hidden" name="pieceId" value={pieceId} />
      <p className="text-caption mb-2 text-neutral-dark/60">
        Piece #{pieceIndex} from {holderName} — {remainingWeightG} g went out.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <FormField
          label="Used (g)"
          htmlFor={`used-${pieceId}`}
          error={errors.amountUsedG}
        >
          <Input
            id={`used-${pieceId}`}
            name="amountUsedG"
            type="number"
            min="0"
            max={remainingWeightG}
            step="0.01"
            defaultValue="0"
            className="w-28"
            invalid={Boolean(errors.amountUsedG)}
          />
        </FormField>
        <FormField
          label="Returned on"
          htmlFor={`returned-${pieceId}`}
          error={errors.returnedAt}
        >
          <Input
            id={`returned-${pieceId}`}
            name="returnedAt"
            type="date"
            max={today}
            defaultValue={today}
            className="w-44"
            invalid={Boolean(errors.returnedAt)}
          />
        </FormField>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Record return"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {/* 0 g is a real answer — the piece came back untouched — and that is what the zero
          entry records. */}
      <p className="text-caption mt-2 text-neutral-dark/55">
        Leave the amount at 0 if it came back untouched.
      </p>
      {state?.formError && <p className="text-caption mt-1 text-danger">{state.formError}</p>}
    </form>
  );
}
