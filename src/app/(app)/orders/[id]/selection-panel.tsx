"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import type { SelectionState } from "./selection-actions";

export type SelectableSupplier = {
  id: string;
  position: number;
  supplierName: string;
  landedPrice: string | null;
  moq: string | null;
  documentCount: number;
};

// Phase 5 — choosing between the options CSS approved. Radio buttons rather than a button
// per row: this is one decision between alternatives, and the terms sit next to each other
// so they can be compared before committing.
export function SelectionPanel({
  orderId,
  suppliers,
  requiredQuantityG,
  action,
}: {
  orderId: string;
  suppliers: SelectableSupplier[];
  requiredQuantityG: string;
  action: (prev: SelectionState, fd: FormData) => Promise<SelectionState>;
}) {
  const [state, submit, pending] = useActionState(action, undefined);
  // Pre-selected when there is only one survivor: the choice is still explicit, but it
  // doesn't make someone tick the only box on offer.
  const [chosen, setChosen] = useState(suppliers.length === 1 ? suppliers[0].id : "");

  return (
    <section className="rounded-lg border border-brand-secondary/30 bg-brand-primary/[0.06] p-5">
      <h2 className="text-section-header text-neutral-dark">Choose a supplier</h2>
      <p className="text-caption mt-0.5 mb-4 text-neutral-dark/70">
        {suppliers.length === 1
          ? "One option was approved. Confirm it to send this request on for costing."
          : `${suppliers.length} options were approved. Pick the one to proceed with.`}
      </p>

      {state?.error && (
        <p className="text-body mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
          {state.error}
        </p>
      )}
      {state?.ok && !state.error && (
        <p className="text-body mb-3 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-on-success">
          {state.ok}
        </p>
      )}

      <form action={submit}>
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
                <span className="text-caption text-neutral-dark/70">
                  {s.landedPrice ?? "—"} · MOQ {s.moq || "—"}
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
          <Button type="submit" disabled={pending || chosen === ""}>
            {pending ? "Recording…" : "Confirm supplier"}
          </Button>
          {chosen === "" && (
            <span className="text-caption pb-2 text-neutral-dark/55">
              Pick an option to continue.
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
