"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import {
  MANUAL_PIECE_LIMIT,
  PIECE_MODES,
  centsToGrams,
  compareQuantities,
  distributeCents,
  pieceSumMessage,
  sumCents,
  toCents,
  type PieceMode,
} from "@/lib/pieces";
import type { ReceiveState } from "./actions";

// Receiving a repeat order into a sample that already exists.
//
// Deliberately not the sample form: there is nothing to describe again and nowhere new to
// put it — the material is identical to what is already on the shelf, and it goes to that
// sample's slot. What is asked for is what varies between deliveries: when it came, how
// much, and in how many pieces.
export function RestockForm({
  orderId,
  sampleCode,
  rmName,
  currentTotalG,
  shelfAddress,
  requestedQuantityG,
  action,
}: {
  orderId: string;
  sampleCode: string;
  rmName: string;
  currentTotalG: string;
  shelfAddress: string;
  requestedQuantityG: string | null;
  action: (prev: ReceiveState, fd: FormData) => Promise<ReceiveState>;
}) {
  const [state, submit, pending] = useActionState(action, undefined);
  const errors = state?.fieldErrors ?? {};

  const [receptionDate, setReceptionDate] = useState("");
  const [qtyG, setQtyG] = useState("");
  const [qtyPcs, setQtyPcs] = useState("");
  const [pieceMode, setPieceMode] = useState<PieceMode>("AUTO");
  // Keyed by index rather than held as a list the piece count has to be kept in step with:
  // the inputs are derived from the count, so changing it can't leave a stale array behind
  // and nothing has to be synchronised in an effect.
  const [manualWeights, setManualWeights] = useState<Record<number, string>>({});

  const totalG = Number(qtyG);
  const pieceCount = Number.parseInt(qtyPcs, 10);
  const piecesReady =
    qtyG.trim() !== "" && Number.isFinite(totalG) && totalG > 0 && pieceCount > 0;

  const expectedCents = piecesReady ? toCents(totalG) : 0;
  const autoSplit = piecesReady ? distributeCents(expectedCents, pieceCount) : [];
  // What is on screen, and what is summed, come from the same derivation — so the check
  // can never be run against a different set of boxes than the one being shown.
  const manualEntries = piecesReady
    ? Array.from({ length: pieceCount }, (_, i) => manualWeights[i] ?? "")
    : [];
  const manualSum = sumCents(manualEntries.map((w) => toCents(Number(w) || 0)));

  const comparison = compareQuantities(requestedQuantityG, qtyG);
  const tooManyToList = piecesReady && pieceCount > MANUAL_PIECE_LIMIT;

  return (
    <form action={submit} className="space-y-6">
      <input type="hidden" name="orderId" value={orderId} />

      {state?.formError && (
        <p className="text-body rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-danger">
          {state.formError}
        </p>
      )}

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header text-neutral-dark">Adding to {sampleCode}</h2>
        <p className="text-body mt-1 text-neutral-dark/60">
          {rmName} — the same material from the same supplier, so this delivery joins the
          stock already on the shelf at {shelfAddress} rather than becoming a second entry.
          It currently holds {currentTotalG} g received in total.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FormField
            label="Reception date"
            htmlFor="receptionDate"
            error={errors.receptionDate}
          >
            <Input
              id="receptionDate"
              name="receptionDate"
              type="date"
              value={receptionDate}
              onChange={(e) => setReceptionDate(e.target.value)}
              invalid={Boolean(errors.receptionDate)}
            />
          </FormField>

          <FormField
            label="Received Quantity (g)"
            htmlFor="receivedQtyG"
            error={errors.receivedQtyG}
          >
            <Input
              id="receivedQtyG"
              name="receivedQtyG"
              type="number"
              min="0"
              step="0.01"
              value={qtyG}
              onChange={(e) => setQtyG(e.target.value)}
              invalid={
                Boolean(errors.receivedQtyG) ||
                comparison.kind === "SHORT" ||
                comparison.kind === "OVER"
              }
            />
            {comparison.kind !== "UNKNOWN" && (
              <p
                className={`text-caption mt-1 ${
                  comparison.kind === "MATCH" ? "text-on-success" : "text-danger"
                }`}
              >
                {comparison.kind === "MATCH"
                  ? `Matches the ${requestedQuantityG} g requested.`
                  : `${comparison.differenceG} g ${
                      comparison.kind === "SHORT" ? "short of" : "more than"
                    } the ${requestedQuantityG} g requested.`}
              </p>
            )}
          </FormField>

          <FormField
            label="Received Quantity (pcs)"
            htmlFor="receivedQtyPcs"
            error={errors.receivedQtyPcs}
          >
            <Input
              id="receivedQtyPcs"
              name="receivedQtyPcs"
              type="number"
              min="1"
              step="1"
              value={qtyPcs}
              onChange={(e) => setQtyPcs(e.target.value)}
              invalid={Boolean(errors.receivedQtyPcs)}
            />
          </FormField>
        </div>
      </section>

      {/* The same piece rules as creating a sample: these pieces are just as real, get their
          own numbers continuing the sample's sequence, and are what stock is counted from. */}
      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header text-neutral-dark">Piece weights</h2>
        <p className="text-body mt-1 text-neutral-dark/60">
          Auto splits the received total evenly, with the remainder on the last piece.
          Manual takes each weight, and they must add up to the total exactly.
        </p>

        <div className="mt-3 flex flex-wrap gap-3">
          {PIECE_MODES.map((mode) => (
            <label
              key={mode}
              className={`cursor-pointer rounded-lg border px-3 py-2 transition-colors duration-150 ${
                pieceMode === mode
                  ? "border-brand-secondary bg-brand-primary/10"
                  : "border-neutral-dark/15 hover:bg-neutral-dark/[0.02]"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="pieceMode"
                  value={mode}
                  checked={pieceMode === mode}
                  onChange={() => setPieceMode(mode)}
                  className="accent-brand-secondary"
                />
                <span className="text-body font-medium text-neutral-dark">
                  {mode === "AUTO" ? "Auto-calculate" : "Manual"}
                </span>
              </span>
            </label>
          ))}
        </div>

        {!piecesReady ? (
          <p className="text-caption mt-3 text-neutral-dark/55">
            Enter the received quantity and the number of pieces first.
          </p>
        ) : pieceMode === "AUTO" ? (
          <p className="text-body mt-3 text-neutral-dark/80">
            {pieceCount} piece{pieceCount === 1 ? "" : "s"}:{" "}
            <span className="tabular-nums">
              {autoSplit.map(centsToGrams).join(" · ")}
            </span>{" "}
            g
          </p>
        ) : tooManyToList ? (
          <p className="text-caption mt-3 text-danger">
            {pieceCount} pieces is too many to enter by hand. Use Auto-calculate, or receive
            in smaller batches.
          </p>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              {manualEntries.map((weight, i) => (
                <FormField key={i} label={`Piece ${i + 1} (g)`} htmlFor={`piece-${i + 1}`}>
                  <Input
                    id={`piece-${i + 1}`}
                    name="pieceWeights"
                    type="number"
                    min="0"
                    step="0.01"
                    value={weight}
                    onChange={(e) =>
                      setManualWeights((prev) => ({ ...prev, [i]: e.target.value }))
                    }
                    invalid={Boolean(errors.pieceWeights)}
                  />
                </FormField>
              ))}
            </div>
            <p
              className={`text-caption mt-2 ${
                manualSum === expectedCents ? "text-on-success" : "text-danger"
              }`}
            >
              {pieceSumMessage(manualSum, expectedCents)}
            </p>
          </>
        )}

        {errors.pieceWeights && (
          <p className="text-caption mt-2 text-danger">{errors.pieceWeights}</p>
        )}
        {errors.pieceMode && (
          <p className="text-caption mt-2 text-danger">{errors.pieceMode}</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add to stock"}
        </Button>
        <a
          href={`/orders/${orderId}`}
          className="text-body text-neutral-dark/70 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
