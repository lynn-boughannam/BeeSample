import Link from "next/link";
import { formatDay as day } from "@/lib/dates";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { shelfAddress, shelfCellKey } from "@/lib/categories";
import { loadShelfCellColors } from "@/lib/shelf";
import { SwatchChip } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import { SampleActions } from "./sample-actions";
import { StockPanel, type PieceRow } from "./stock-panel";
import { discardSample, restoreSample, deleteSample } from "./actions";
import { addReceivedStock, checkoutPiece, discardPieces, logPieceUsage } from "./stock-actions";
import { stockFromPieces, getCheckoutWarningLevel, type PieceStatus } from "@/lib/stock";


// The server's calendar day. toISOString() would give the UTC day, which can be a day off
// from the clock the checkout action compares against.
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Transaction.type is a plain string column (SQL Server has no enum) — see
// TRANSACTION_TYPES in src/lib/types.ts for the full set.
const TRANSACTION_LABELS: Record<string, string> = {
  RECEIPT: "Received",
  CHECKOUT: "Checked out",
  RETURN_USAGE: "Usage logged",
  DISCARD: "Discarded",
  MOVE: "Moved",
};

const TRANSACTION_VARIANT: Record<string, "success" | "warning" | "info" | "danger" | "neutral"> = {
  RECEIPT: "success",
  CHECKOUT: "warning",
  RETURN_USAGE: "info",
  DISCARD: "danger",
  MOVE: "neutral",
};

export default async function SampleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await verifySession();
  const isAdmin = session.user.role === "ADMIN";

  const sample = await prisma.sample.findUnique({
    where: { id },
    include: {
      ingredients: { include: { ingredient: true } },
      pieces: {
        orderBy: { pieceIndex: "asc" },
        include: { checkedOutToUser: { select: { name: true } } },
      },
      locationHistory: { include: { movedBy: true }, orderBy: { movedAt: "desc" } },
      createdBy: true,
      discardedBy: true,
    },
  });

  if (!sample) notFound();

  // Permanent delete is only offered when nothing else references the sample; otherwise
  // discarding is the correct action and the reason is shown in its place.
  const [requests, feedback, transactions, orders, history] = await Promise.all([
    prisma.sampleRequest.count({ where: { sampleId: id } }),
    prisma.feedback.count({ where: { sampleId: id } }),
    prisma.transaction.count({ where: { sampleId: id } }),
    prisma.sampleOrder.count({ where: { existingSampleId: id } }),
    // The audit trail behind the piece list: who took what, who logged it, and when.
    prisma.transaction.findMany({
      where: { sampleId: id },
      include: { performedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const dependents = requests + feedback + transactions + orders;

  // The swatch belongs to the shelf cell, not the category — it's the plan's own colour
  // for where this sample physically sits.
  const shelfColors = await loadShelfCellColors();

  // Current stock is computed from the pieces loaded above (SLT-29) rather than read from
  // a stored column, so it can't disagree with the rows it summarises.
  const stock = stockFromPieces(sample.pieces);

  // Only active formulators can take custody of a piece.
  const formulators = isAdmin
    ? await prisma.user.findMany({
        where: { isActive: true, role: { name: "FORMULATOR" } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  const pieceRows: PieceRow[] = sample.pieces.map((p) => ({
    id: p.id,
    pieceIndex: p.pieceIndex,
    originalWeightG: Number(p.originalWeightG).toFixed(2),
    remainingWeightG: Number(p.remainingWeightG).toFixed(2),
    status: p.status as PieceStatus,
    checkedOutToName: p.checkedOutToUser?.name ?? null,
    checkedOutAt: p.checkedOutAt ? day(p.checkedOutAt) : null,
    checkoutWarning: getCheckoutWarningLevel(p.checkedOutAt),
    discardReason: p.discardReason,
  }));
  const shelfSwatch =
    shelfColors[shelfCellKey(sample.shelfLetter, sample.shelfLevel)] ?? "#CCCCCC";

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/library" className="text-caption text-neutral-dark/60 hover:underline">
          ← Sample Library
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-page-title text-neutral-dark">{sample.rmName}</h1>
            <p className="text-body mt-0.5 text-neutral-dark/60">{sample.sampleCode}</p>
          </div>
          {isAdmin && !sample.isDiscarded && (
            <Link
              href={`/library/${sample.id}/edit`}
              className="text-body inline-flex items-center rounded-lg bg-brand-primary px-4 py-2 font-medium text-on-primary transition-[transform,opacity] duration-150 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              Edit sample
            </Link>
          )}
        </div>
      </div>

      {sample.isDiscarded && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-4">
          <div className="flex items-center gap-2">
            <Badge variant="danger">Discarded</Badge>
            <span className="text-caption text-neutral-dark/60">
              {sample.discardedAt ? day(sample.discardedAt) : "—"}
              {sample.discardedBy ? ` by ${sample.discardedBy.name}` : ""}
            </span>
          </div>
          <p className="text-body mt-2 text-neutral-dark">{sample.discardReason}</p>
        </div>
      )}

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-4 text-neutral-dark">Details</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 md:grid-cols-3">
          <Field label="Category">
            {sample.category}
          </Field>
          <Field label="Fragrance orientation">
            {sample.fragranceOrientation || <Missing />}
          </Field>
          <Field label="Function">{sample.function || <Missing />}</Field>
          <Field label="Physical form">{sample.physicalForm || <Missing />}</Field>
          <Field label="Source">{sample.source}</Field>
          <Field label="Supplier">{sample.supplier}</Field>
          <Field label="Project">{sample.projectName || <Missing />}</Field>
          <Field label="Hazard class">
            {sample.hazardClass ? (
              <Badge variant={sample.hazardClass === "Hazardous" ? "danger" : "success"}>
                {sample.hazardClass}
              </Badge>
            ) : (
              <Missing />
            )}
          </Field>
          <Field label="Batch / Lot">{sample.batchLot || <Missing />}</Field>
          <Field label="Documents available">
            {sample.documentAvailability
              ? sample.documentAvailability === "YES"
                ? "Yes"
                : "No"
              : <Missing />}
          </Field>
          <Field label="Shelf location">
            <SwatchChip
              colorHex={shelfSwatch}
              label={shelfAddress(sample.shelfLetter, sample.shelfLevel, sample.shelfSublevel)}
            />
          </Field>
          <Field label="Reception date">{day(sample.receptionDate)}</Field>
          <Field label="Expiry date">{day(sample.expiryDate)}</Field>
          <Field label="Quantity">
            {stock.remainingQtyG} g remaining of {sample.totalQtyG.toString()} g received
            {" · "}
            {stock.remainingQtyPcs} pc{stock.remainingQtyPcs === 1 ? "" : "s"}
          </Field>
          <Field label="Net weight">
            {sample.netWeightG != null ? `${sample.netWeightG.toString()} g` : <Missing />}
          </Field>
          <Field label="Created by">{sample.createdBy.name}</Field>
          <Field label="Created">{day(sample.createdAt)}</Field>
        </dl>
      </section>

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-3 text-neutral-dark">
          INCI ingredients{" "}
          <span className="text-caption font-normal text-neutral-dark/50">
            ({sample.ingredients.length})
          </span>
        </h2>
        {sample.ingredients.length === 0 ? (
          <p className="text-body text-neutral-dark/50">No ingredients recorded.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {sample.ingredients.map((si) => (
              <li key={si.ingredientId}>
                <Badge variant="neutral">
                  {si.ingredient.inciName}
                  {si.ingredient.chemicalFamily ? ` · ${si.ingredient.chemicalFamily}` : ""}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* SLT-56 / SLT-29. Pieces are created with the sample and never edited by hand —
          they change only through checkout and logged usage, which is what this panel
          drives. Non-admins see the same list, read-only. */}
      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-1 text-neutral-dark">
          Stock by piece{" "}
          <span className="text-caption font-normal text-neutral-dark/50">
            ({sample.pieces.length})
          </span>
        </h2>
        <p className="text-caption mb-4 text-neutral-dark/60">
          {stock.remainingQtyG} g across {stock.remainingQtyPcs} piece
          {stock.remainingQtyPcs === 1 ? "" : "s"} still in stock. Checking a piece out
          records who has it and doesn&apos;t change these figures — only logged usage does.
        </p>
        <StockPanel
          pieces={pieceRows}
          formulators={formulators}
          isAdmin={isAdmin}
          isDiscarded={sample.isDiscarded}
          today={localDay(new Date())}
          sampleId={sample.id}
          checkoutAction={checkoutPiece}
          logUsageAction={logPieceUsage}
          addStockAction={addReceivedStock}
          discardAction={discardPieces}
        />
      </section>

      {/* SLT-56 / SLT-29 final AC: every checkout and logged usage is visible here, with
          the formulator who had the piece and the Admin who recorded it. CHECKOUT rows
          carry no quantity — nothing is consumed until a usage is logged. */}
      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-3 text-neutral-dark">
          Transaction history{" "}
          <span className="text-caption font-normal text-neutral-dark/50">
            ({history.length})
          </span>
        </h2>
        {history.length === 0 ? (
          <p className="text-body text-neutral-dark/50">
            No stock movements recorded yet. Checking a piece out or logging usage adds an
            entry here.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-dark/8">
            {history.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <Badge variant={TRANSACTION_VARIANT[t.type] ?? "neutral"}>
                  {TRANSACTION_LABELS[t.type] ?? t.type}
                </Badge>
                {/* Only usage actually moves stock; a null quantity is a custody-only event. */}
                <span className="text-body font-medium text-neutral-dark">
                  {t.quantityG != null ? `${Number(t.quantityG).toFixed(2)} g` : "—"}
                </span>
                <span className="text-caption text-neutral-dark/60">{day(t.createdAt)}</span>
                <span className="text-caption text-neutral-dark/60">
                  logged by {t.performedBy.name}
                </span>
                {t.note && (
                  <span className="text-caption ml-auto text-neutral-dark/50">{t.note}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-3 text-neutral-dark">Location history</h2>
        {sample.locationHistory.length === 0 ? (
          <p className="text-body text-neutral-dark/50">No location history recorded.</p>
        ) : (
          <ul className="divide-y divide-neutral-dark/8">
            {sample.locationHistory.map((lh) => (
              <li key={lh.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="text-body font-medium text-neutral-dark">
                  {shelfAddress(lh.shelfLetter, lh.shelfLevel, lh.shelfSublevel)}
                </span>
                <span className="text-caption text-neutral-dark/60">{day(lh.movedAt)}</span>
                {lh.movedBy && (
                  <span className="text-caption text-neutral-dark/60">{lh.movedBy.name}</span>
                )}
                {lh.note && (
                  <span className="text-caption ml-auto text-neutral-dark/50">{lh.note}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isAdmin && (
        <section>
          <h2 className="text-section-header mb-3 text-neutral-dark">Manage</h2>
          <SampleActions
            sampleId={sample.id}
            isDiscarded={sample.isDiscarded}
            canDelete={dependents === 0}
            blockedReason={
              dependents === 0
                ? null
                : `Permanent delete unavailable — ${dependents} linked record${dependents === 1 ? "" : "s"} (requests, feedback or transactions). Discard instead.`
            }
            discardAction={discardSample}
            restoreAction={restoreSample}
            deleteAction={deleteSample}
          />
        </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-neutral-dark/50">{label}</dt>
      <dd className="text-body mt-0.5 text-neutral-dark">{children}</dd>
    </div>
  );
}

function Missing() {
  return <span className="text-neutral-dark/40">Not recorded</span>;
}
