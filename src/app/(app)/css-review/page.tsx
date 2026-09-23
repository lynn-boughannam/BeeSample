import Link from "next/link";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { formatDay as day } from "@/lib/dates";
import { orderLabel, survivingSuppliers } from "@/lib/orders";
import type { OrderStatus } from "@/lib/types";
import {
  SLA_ROW_CLASS,
  SLA_TEXT_CLASS,
  cssReviewDueDate,
  cssReviewSlaLevel,
  cssReviewWorkingDaysElapsed,
  slaLabel,
  CSS_REVIEW_SLA_DAYS,
} from "@/lib/working-days";
import { DecisionButtons } from "./decision-buttons";
import { approveSupplierDocuments, rejectSupplierDocuments } from "./actions";

// Phase 4 — the CSS queue.
//
// What CSS judges here is a supplier's DOCUMENTS. Costing approval is a later step and
// belongs to the Formulator (COSTING_SUBMITTED_PENDING_FORMULATOR in the status track);
// landed price and MOQ appear on each row as context for comparing options, not as the
// thing being decided.
//
// Two sections, because a decision that disappears the moment it is made is not a record.
// Reviewed work stays here with its reason, its documents and its date — including the
// requests CSS ended by rejecting every option, which leave the pending list entirely.
//
// Options are grouped by request rather than listed flat: the decision is comparative —
// these options are alternatives to one another, and the terms each quoted are part of
// weighing them up.

// Everything needed to render one supplier row, from either section.
const supplierSelect = Prisma.validator<Prisma.SampleOrderSupplierSelect>()({
  id: true,
  position: true,
  supplierName: true,
  landedPrice: true,
  moq: true,
  submittedToCssAt: true,
  cssDecision: true,
  cssDecisionAt: true,
  cssNote: true,
  cssDecidedBy: { select: { name: true } },
  // Names only — a document is opened through the authenticated route, and no list here
  // needs the bytes.
  documents: { orderBy: { uploadedAt: "asc" }, select: { id: true, fileName: true } },
});

const orderSelect = Prisma.validator<Prisma.SampleOrderSelect>()({
  id: true,
  status: true,
  inciName: true,
  requiredQuantityG: true,
  rejectionReason: true,
  existingSample: { select: { sampleCode: true, rmName: true } },
  suppliers: { orderBy: { position: "asc" }, select: supplierSelect },
});

export default async function CssReviewPage() {
  const session = await verifySession();
  const role = session.user.role;
  // CSS owns this queue; an Admin can work it when they're away.
  if (role !== "CSS" && role !== "ADMIN") redirect("/dashboard");

  const [pendingOrders, reviewedOrders] = await Promise.all([
    prisma.sampleOrder.findMany({
      where: {
        status: "APPROVED_PENDING_SUPPLY_CHAIN",
        suppliers: { some: { submittedToCssAt: { not: null }, cssDecision: "PENDING" } },
      },
      select: orderSelect,
    }),
    // Deliberately not filtered by order status: a request CSS rejected outright is no
    // longer pending anything, and is exactly the one they most need to be able to look
    // back at.
    prisma.sampleOrder.findMany({
      where: { suppliers: { some: { cssDecision: { in: ["APPROVED", "REJECTED"] } } } },
      select: orderSelect,
      take: 25,
    }),
  ]);

  const now = new Date();

  // Most pressing request first, judged by its longest-waiting option.
  const pending = pendingOrders
    .map((order) => ({
      order,
      waiting: order.suppliers.filter((s) => s.submittedToCssAt && s.cssDecision === "PENDING"),
      oldest: order.suppliers.reduce<Date | null>(
        (acc, s) =>
          s.submittedToCssAt && s.cssDecision === "PENDING" && (!acc || s.submittedToCssAt < acc)
            ? s.submittedToCssAt
            : acc,
        null
      ),
    }))
    .sort((a, b) => (a.oldest?.getTime() ?? 0) - (b.oldest?.getTime() ?? 0));

  const pendingIds = new Set(pending.map((p) => p.order.id));

  // Most recently decided first. That date lives on the suppliers rather than the order,
  // so it is sorted here instead of in SQL.
  const lastDecidedAt = (o: (typeof reviewedOrders)[number]) =>
    o.suppliers
      .reduce(
        (latest, s) => (s.cssDecisionAt && s.cssDecisionAt > latest ? s.cssDecisionAt : latest),
        new Date(0)
      )
      .getTime();

  // A request can have one option decided and another still waiting; it belongs in the
  // pending list, and repeating it below would be noise.
  const reviewed = reviewedOrders
    .filter((o) => !pendingIds.has(o.id))
    .sort((a, b) => lastDecidedAt(b) - lastDecidedAt(a));

  const pendingCount = pending.reduce((n, g) => n + g.waiting.length, 0);

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-page-title text-neutral-dark">Document review</h1>
        <p className="text-body mt-1 text-neutral-dark/60">
          {pendingCount === 0
            ? "Nothing is waiting on you. Everything you've reviewed is below."
            : `${pendingCount} supplier option${
                pendingCount === 1 ? "" : "s"
              } awaiting a decision, expected within ${CSS_REVIEW_SLA_DAYS} working days of being sent.`}
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-section-header text-neutral-dark">Awaiting your decision</h2>
        {pending.length === 0 ? (
          <div className="rounded-lg border border-neutral-dark/10 bg-white p-8 text-center shadow-elevated">
            <p className="text-body text-neutral-dark/60">Nothing is waiting on CSS.</p>
            <p className="text-caption mt-1 text-neutral-dark/45">
              Supply Chain sends supplier options here once their documents and pricing are in.
            </p>
          </div>
        ) : (
          pending.map(({ order, waiting }) => (
            <OrderCard
              key={order.id}
              order={order}
              waitingIds={new Set(waiting.map((w) => w.id))}
              now={now}
            />
          ))
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-section-header text-neutral-dark">
          Reviewed{" "}
          <span className="text-caption font-normal text-neutral-dark/50">({reviewed.length})</span>
        </h2>
        {reviewed.length === 0 ? (
          <p className="text-body text-neutral-dark/50">You haven&apos;t decided anything yet.</p>
        ) : (
          reviewed.map((order) => (
            <OrderCard key={order.id} order={order} waitingIds={new Set()} now={now} />
          ))
        )}
      </section>
    </div>
  );
}

type OrderRow = {
  id: string;
  status: string;
  inciName: string | null;
  requiredQuantityG: string | null;
  rejectionReason: string | null;
  existingSample: { sampleCode: string; rmName: string } | null;
  suppliers: Array<{
    id: string;
    position: number;
    supplierName: string;
    landedPrice: unknown;
    moq: string | null;
    submittedToCssAt: Date | null;
    cssDecision: string;
    cssDecisionAt: Date | null;
    cssNote: string | null;
    cssDecidedBy: { name: string } | null;
    documents: Array<{ id: string; fileName: string }>;
  }>;
};

function OrderCard({
  order,
  waitingIds,
  now,
}: {
  order: OrderRow;
  waitingIds: Set<string>;
  now: Date;
}) {
  const live = survivingSuppliers(order.suppliers);
  const wholeOrderRejected = (order.status as OrderStatus) === "REJECTED";

  return (
    <div className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <Link
          href={`/orders/${order.id}`}
          className="text-section-header text-neutral-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
        >
          {orderLabel(order)}
        </Link>
        <span className="text-caption text-neutral-dark/60">
          {order.requiredQuantityG ? `${order.requiredQuantityG} g required · ` : ""}
          {wholeOrderRejected ? (
            <Badge variant="danger">Request rejected</Badge>
          ) : (
            `${live.length} option${live.length === 1 ? "" : "s"} still live`
          )}
        </span>
      </div>

      {/* Why the request as a whole ended, kept with the decisions that ended it. */}
      {wholeOrderRejected && order.rejectionReason && (
        <p className="text-body mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
          {order.rejectionReason}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left">
          <thead className="border-b border-neutral-dark/10">
            <tr>
              <Th>Supplier</Th>
              <Th numeric>Landed price</Th>
              <Th>MOQ</Th>
              <Th>Documents</Th>
              <Th>Due</Th>
              <Th>Decision</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-dark/8">
            {/* Every option is shown, decided or not: a price only means something next to
                the ones it was competing with. */}
            {order.suppliers.map((supplier) => {
              const pending = waitingIds.has(supplier.id);
              const rejected = supplier.cssDecision === "REJECTED";
              const sla = cssReviewSlaLevel(
                supplier.submittedToCssAt,
                supplier.cssDecisionAt,
                now
              );
              const elapsed = cssReviewWorkingDaysElapsed(
                supplier.submittedToCssAt,
                supplier.cssDecisionAt,
                now
              );
              const due = supplier.submittedToCssAt
                ? cssReviewDueDate(supplier.submittedToCssAt)
                : null;

              return (
                <tr key={supplier.id} className={pending ? SLA_ROW_CLASS[sla] : undefined}>
                  <Td>
                    <span className="text-caption mr-1.5 text-neutral-dark/45">
                      #{supplier.position}
                    </span>
                    <span
                      className={`text-body ${
                        rejected ? "text-neutral-dark/50 line-through" : "text-neutral-dark"
                      }`}
                    >
                      {supplier.supplierName}
                    </span>
                  </Td>
                  <Td numeric>{supplier.landedPrice?.toString() ?? <Dash />}</Td>
                  <Td>{supplier.moq || <Dash />}</Td>
                  <Td>
                    {/* Documents stay reachable after a decision — the reason for it is
                        in them, and a rejection often needs revisiting. */}
                    {supplier.documents.length === 0 ? (
                      <span className="text-caption text-neutral-dark/45">none</span>
                    ) : (
                      <span className="flex flex-wrap gap-x-2 gap-y-1">
                        {supplier.documents.map((doc) => (
                          <a
                            key={doc.id}
                            href={`/api/order-documents/${doc.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-caption text-neutral-dark underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
                          >
                            {doc.fileName}
                          </a>
                        ))}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {supplier.submittedToCssAt && due ? (
                      <span className={`text-caption ${pending ? SLA_TEXT_CLASS[sla] : "text-neutral-dark/55"}`}>
                        {day(due)}
                        {slaLabel(sla, elapsed, !pending) ? ` · ${slaLabel(sla, elapsed, !pending)}` : ""}
                      </span>
                    ) : (
                      <Dash />
                    )}
                  </Td>
                  <Td>
                    {pending ? (
                      <DecisionButtons
                        orderSupplierId={supplier.id}
                        supplierName={supplier.supplierName}
                        isLastOption={live.length === 1}
                        approveAction={approveSupplierDocuments}
                        rejectAction={rejectSupplierDocuments}
                      />
                    ) : (
                      <div>
                        <Badge
                          variant={
                            rejected
                              ? "danger"
                              : supplier.cssDecision === "APPROVED"
                                ? "success"
                                : "neutral"
                          }
                        >
                          {supplier.cssDecision === "PENDING"
                            ? "Not sent yet"
                            : supplier.cssDecision.toLowerCase()}
                        </Badge>
                        {supplier.cssDecisionAt && (
                          <p className="text-caption mt-1 text-neutral-dark/55">
                            {supplier.cssDecidedBy?.name ?? "—"} · {day(supplier.cssDecisionAt)}
                          </p>
                        )}
                        {/* The reason, kept where the decision is — an elimination nobody
                            can explain gets re-sourced identically next time. */}
                        {supplier.cssNote && (
                          <p className="text-caption mt-1 text-neutral-dark/70">
                            {supplier.cssNote}
                          </p>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, numeric }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={`text-caption px-3 py-2 font-semibold text-neutral-dark/60 ${
        numeric ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, numeric }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <td className={`text-body px-3 py-3 align-top ${numeric ? "text-right tabular-nums" : ""}`}>
      {children}
    </td>
  );
}

function Dash() {
  return <span className="text-neutral-dark/30">—</span>;
}
