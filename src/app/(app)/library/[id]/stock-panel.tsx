"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/input";
import {
  CHECKOUT_ROW_CLASS,
  PIECE_STATUS_LABELS,
  type CheckoutWarningLevel,
  type PieceStatus,
} from "@/lib/stock";
import type { StockActionState } from "./stock-actions";

export type PieceRow = {
  id: string;
  pieceIndex: number;
  originalWeightG: string;
  remainingWeightG: string;
  status: PieceStatus;
  checkedOutToName: string | null;
  checkedOutAt: string | null;
  // Computed on the server from the raw date, since this component only receives the
  // formatted string. Same levels as every other screen (SLT-57).
  checkoutWarning: CheckoutWarningLevel;
  discardReason: string | null;
};

type Formulator = { id: string; name: string };

// The discard form sits below the piece list, and the per-row checkboxes point at it by
// id — nesting it around the list would put a <form> inside a <form>.
const DISCARD_FORM_ID = "discard-pieces-form";

const STATUS_VARIANT: Record<PieceStatus, "success" | "warning" | "neutral" | "danger"> = {
  IN_STOCK: "success",
  CHECKED_OUT: "warning",
  DEPLETED: "neutral",
  DISCARDED: "danger",
};

// SLT-56 + SLT-29. One row per physical piece: what it weighs now, who has it, and the
// one action that piece's current state allows.
export function StockPanel({
  pieces,
  formulators,
  isAdmin,
  isDiscarded,
  today,
  sampleId,
  checkoutAction,
  logUsageAction,
  addStockAction,
  discardAction,
}: {
  pieces: PieceRow[];
  formulators: Formulator[];
  sampleId: string;
  // Both actions are Admin-only (requireAdmin in stock-actions.ts). Everyone else gets the
  // same piece list read-only, rather than buttons that bounce them to the dashboard.
  isAdmin: boolean;
  isDiscarded: boolean;
  // The server's today, as yyyy-mm-dd. Passed in rather than computed here so the date
  // picker's ceiling matches the clock the action validates against, and so the markup
  // doesn't differ between the server render and hydration.
  today: string;
  checkoutAction: (prev: StockActionState, fd: FormData) => Promise<StockActionState>;
  logUsageAction: (prev: StockActionState, fd: FormData) => Promise<StockActionState>;
  addStockAction: (prev: StockActionState, fd: FormData) => Promise<StockActionState>;
  discardAction: (prev: StockActionState, fd: FormData) => Promise<StockActionState>;
}) {
  // One action state for the whole panel: only one piece is ever being acted on at a
  // time, and sharing it keeps the result message from following the wrong row.
  const [checkoutState, checkout, checkingOut] = useActionState(checkoutAction, undefined);
  const [usageState, logUsage, loggingUsage] = useActionState(logUsageAction, undefined);
  const [addStockState, addStock, addingStock] = useActionState(addStockAction, undefined);
  const [discardState, discard, discarding] = useActionState(discardAction, undefined);
  const [openPieceId, setOpenPieceId] = useState<string | null>(null);
  // Discard is a bulk action, so it runs as its own mode: while it's on, the in-stock rows
  // show checkboxes instead of their per-piece buttons.
  const [discardMode, setDiscardMode] = useState(false);

  const banner =
    checkoutState?.formError ?? usageState?.formError ?? addStockState?.formError ?? discardState?.formError;
  const success = checkoutState?.ok ?? usageState?.ok ?? addStockState?.ok ?? discardState?.ok;

  const inStockCount = pieces.filter((p) => p.status === "IN_STOCK").length;

  return (
    <div className="space-y-3">
      {banner && (
        <p className="text-caption rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
          {banner}
        </p>
      )}
      {/* success is a vibrant lime that only works as a surface — globals.css pairs it
          with on-success for the text, never the other way round. */}
      {success && !banner && (
        <p className="text-caption rounded-md border border-success/40 bg-success/10 px-3 py-2 text-on-success">
          {success}
        </p>
      )}

      {pieces.length === 0 ? (
        <p className="text-body text-neutral-dark/50">
          No pieces recorded. Adding received stock below will create the first one.
        </p>
      ) : (
        <>
          {isAdmin && !isDiscarded && inStockCount > 0 && (
        <div className="mb-2 flex flex-wrap items-center justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDiscardMode(!discardMode);
              setOpenPieceId(null);
            }}
          >
            {discardMode ? "Cancel discard" : "Discard pieces"}
          </Button>
        </div>
      )}
      <ul className="divide-y divide-neutral-dark/10 rounded-lg border border-neutral-dark/10">
        {pieces.map((piece) => {
          const isOpen = openPieceId === piece.id;
          return (
            <li key={piece.id} className={`p-3 ${CHECKOUT_ROW_CLASS[piece.checkoutWarning]}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Only in-stock pieces are selectable — a checked-out one has to be
                      logged back in first (SLT-55 AC-2). */}
                  {discardMode &&
                    (piece.status === "IN_STOCK" ? (
                      <input
                        type="checkbox"
                        // Associates this box with the discard form below, which sits
                        // outside the list so the per-piece forms aren't nested inside it.
                        form={DISCARD_FORM_ID}
                        name="pieceIds"
                        value={piece.id}
                        aria-label={`Discard piece ${piece.pieceIndex}`}
                        className="h-4 w-4 shrink-0 accent-danger"
                      />
                    ) : (
                      <span aria-hidden className="h-4 w-4 shrink-0" />
                    ))}
                  <span className="text-caption text-neutral-dark/50">#{piece.pieceIndex}</span>
                  <span className="text-body font-medium text-neutral-dark">
                    {piece.remainingWeightG} g
                  </span>
                  {/* Only worth showing once the piece has actually lost weight. */}
                  {piece.remainingWeightG !== piece.originalWeightG && (
                    <span className="text-caption text-neutral-dark/50">
                      of {piece.originalWeightG} g
                    </span>
                  )}
                  <Badge variant={STATUS_VARIANT[piece.status]}>
                    {PIECE_STATUS_LABELS[piece.status]}
                  </Badge>
                  {piece.checkedOutToName && (
                    <span className="text-caption text-neutral-dark/60">
                      with {piece.checkedOutToName}
                      {piece.checkedOutAt ? ` since ${piece.checkedOutAt}` : ""}
                    </span>
                  )}
                  {piece.status === "DISCARDED" && piece.discardReason && (
                    <span className="text-caption text-neutral-dark/60">
                      {piece.discardReason}
                    </span>
                  )}
                </div>

                {!discardMode && isAdmin && !isDiscarded && piece.status === "IN_STOCK" && formulators.length > 0 && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setOpenPieceId(isOpen ? null : piece.id)}
                  >
                    {isOpen ? "Cancel" : "Check out"}
                  </Button>
                )}
                {!discardMode && isAdmin && !isDiscarded && piece.status === "CHECKED_OUT" && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setOpenPieceId(isOpen ? null : piece.id)}
                  >
                    {isOpen ? "Cancel" : "Log usage"}
                  </Button>
                )}
              </div>

              {isOpen && piece.status === "IN_STOCK" && (
                <form action={checkout} className="mt-3 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="pieceId" value={piece.id} />
                  <FormField
                    label="Check out to"
                    htmlFor={`formulator-${piece.id}`}
                    error={checkoutState?.fieldErrors?.formulatorId}
                  >
                    <Select
                      id={`formulator-${piece.id}`}
                      name="formulatorId"
                      defaultValue=""
                      invalid={Boolean(checkoutState?.fieldErrors?.formulatorId)}
                    >
                      <option value="">Select a formulator…</option>
                      {formulators.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  {/* Defaults to today. Backdating is allowed because a checkout is often
                      recorded after the fact; the max attribute stops the picker offering
                      a future date, and the action rejects one anyway. */}
                  <FormField
                    label="Checkout date"
                    htmlFor={`checked-out-at-${piece.id}`}
                    error={checkoutState?.fieldErrors?.checkedOutAt}
                  >
                    <Input
                      id={`checked-out-at-${piece.id}`}
                      name="checkedOutAt"
                      type="date"
                      max={today}
                      defaultValue={today}
                      invalid={Boolean(checkoutState?.fieldErrors?.checkedOutAt)}
                    />
                  </FormField>
                  <Button type="submit" disabled={checkingOut}>
                    {checkingOut ? "Checking out…" : "Confirm checkout"}
                  </Button>
                </form>
              )}

              {isOpen && piece.status === "CHECKED_OUT" && (
                <form action={logUsage} className="mt-3 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="pieceId" value={piece.id} />
                  <FormField
                    label="Actual amount used (g)"
                    htmlFor={`used-${piece.id}`}
                    error={usageState?.fieldErrors?.amountUsedG}
                  >
                    <Input
                      id={`used-${piece.id}`}
                      name="amountUsedG"
                      type="number"
                      step="0.01"
                      min="0"
                      max={piece.remainingWeightG}
                      defaultValue="0"
                      invalid={Boolean(usageState?.fieldErrors?.amountUsedG)}
                    />
                  </FormField>
                  <Button type="submit" disabled={loggingUsage}>
                    {loggingUsage ? "Logging…" : "Log usage"}
                  </Button>
                  <p className="text-caption pb-2 text-neutral-dark/60">
                    Up to {piece.remainingWeightG} g. 0 g means it came back untouched.
                  </p>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      {discardMode && (
        <form
          id={DISCARD_FORM_ID}
          action={discard}
          className="mt-2 flex flex-wrap items-end gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3"
        >
          <input type="hidden" name="sampleId" value={sampleId} />
          <FormField
            label="Reason for discarding"
            htmlFor="discard-reason"
            error={discardState?.fieldErrors?.reason}
          >
            <Input
              id="discard-reason"
              name="reason"
              placeholder="Expired"
              invalid={Boolean(discardState?.fieldErrors?.reason)}
            />
          </FormField>
          <Button type="submit" disabled={discarding}>
            {discarding ? "Discarding…" : "Discard selected"}
          </Button>
          {discardState?.fieldErrors?.pieceIds && (
            <p className="text-caption pb-2 text-danger">{discardState.fieldErrors.pieceIds}</p>
          )}
          <p className="text-caption pb-2 text-neutral-dark/60">
            Tick the in-stock pieces that are no longer usable. Their weights are already
            tracked — nothing to re-enter.
          </p>
            </form>
          )}
        </>
      )}

      {/* SLT-25. Admin only, and never on a discarded sample. Works at any stock level —
          this is how a zero-stock sample comes back. */}
      {isAdmin && !isDiscarded && (
        <form
          action={addStock}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-dark/10 bg-neutral-dark/[0.02] p-3"
        >
          <input type="hidden" name="sampleId" value={sampleId} />
          <FormField
            label="Additional weight received (g)"
            htmlFor="amountG"
            error={addStockState?.fieldErrors?.amountG}
          >
            <Input
              id="amountG"
              name="amountG"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              invalid={Boolean(addStockState?.fieldErrors?.amountG)}
            />
          </FormField>
          <Button type="submit" disabled={addingStock}>
            {addingStock ? "Adding…" : "Add to Stock"}
          </Button>
          <p className="text-caption pb-2 text-neutral-dark/60">
            A new batch, not a correction — it arrives as a new piece and raises the
            received total.
          </p>
        </form>
      )}

      {isAdmin && !isDiscarded && pieces.length > 0 && formulators.length === 0 && (
        <p className="text-caption text-neutral-dark/60">
          No active formulators to check pieces out to. Add one in Settings &rarr; Users.
        </p>
      )}
    </div>
  );
}
