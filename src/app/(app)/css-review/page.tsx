import Link from "next/link";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { formatDay as day } from "@/lib/dates";
import { orderLabel, survivingSuppliers } from "@/lib/orders";
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
import { approveSupplierCosting, rejectSupplierCosting } from "./actions";

// Phase 4 — the CSS queue: every supplier option waiting on a costing decision, across
// all requests.
//
// Grouped by request rather than listed flat, because the decision is comparative: these
// options are alternatives to one another, and judging a landed price means seeing what
// the others quoted. A flat list sorted by deadline would scatter siblings apart.

export default async function CssReviewPage() {
  const session = await verifySession();
  const role = session.user.role;
  // CSS owns this queue; an Admin can work it when they're away.
  if (role !== "CSS" && role !== "ADMIN") redirect("/dashboard");

  const orders = await prisma.sampleOrder.findMany({
    where: {
      status: "APPROVED_PENDING_SUPPLY_CHAIN",
      suppliers: { some: { submittedToCssAt: { not: null }, cssDecision: "PENDING" } },
    },
    select: {
      id: true,
      inciName: true,
      requiredQuantityG: true,
      existingSample: { select: { sampleCode: true, rmName: true } },
      suppliers: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          supplierName: true,
          landedPrice: true,
          moq: true,
          submittedToCssAt: true,
          cssDecision: true,
          cssNote: true,
          // Names only — CSS opens a document through the authenticated route, and a
          // list never needs the bytes.
          documents: {
            orderBy: { uploadedAt: "asc" },
            select: { id: true, fileName: true },
          },
        },
      },
    },
  });

  const now = new Date();

  // Most pressing request first, judged by its longest-waiting option.
  const groups = orders
    .map((order) => {
      const waiting = order.suppliers.filter(
        (s) => s.submittedToCssAt && s.cssDecision === "PENDING"
      );
      const oldest = waiting.reduce<Date | null>(
        (acc, s) => (!acc || (s.submittedToCssAt && s.submittedToCssAt < acc) ? s.submittedToCssAt : acc),
        null
      );
      return { order, waiting, oldest };
    })
    .sort((a, b) => (a.oldest?.getTime() ?? 0) - (b.oldest?.getTime() ?? 0));

  const pendingCount = groups.reduce((n, g) => n + g.waiting.length, 0);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-page-title text-neutral-dark">Costing review</h1>
        <p className="text-body mt-1 text-neutral-dark/60">
          {pendingCount === 0
            ? "Nothing is waiting on CSS."
            : `${pendingCount} supplier option${
                pendingCount === 1 ? "" : "s"
              } awaiting a decision. Reviews are expected within ${CSS_REVIEW_SLA_DAYS} working days of being sent.`}
        </p>
      </div>

      {groups.length === 0 ? (
        <section className="rounded-lg border border-neutral-dark/10 bg-white p-8 text-center shadow-elevated">
          <p className="text-body text-neutral-dark/60">Nothing is waiting on CSS.</p>
          <p className="text-caption mt-1 text-neutral-dark/45">
            Supply Chain sends supplier options here once their documents and pricing are in.
          </p>
        </section>
      ) : (
        groups.map(({ order, waiting }) => {
          // Rejecting the last live option ends the request, so the buttons say so.
          const live = survivingSuppliers(order.suppliers);

          return (
            <section
              key={order.id}
              className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated"
            >
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <Link
                  href={`/orders/${order.id}`}
                  className="text-section-header text-neutral-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
                >
                  {orderLabel(order)}
                </Link>
                <span className="text-caption text-neutral-dark/60">
                  {order.requiredQuantityG ? `${order.requiredQuantityG} g required · ` : ""}
                  {live.length} option{live.length === 1 ? "" : "s"} still live
                </span>
              </div>

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
                    {/* Every option is shown, decided or not: a price only means something
                        next to the ones it is competing with. */}
                    {order.suppliers.map((supplier) => {
                      const pending = waiting.some((w) => w.id === supplier.id);
                      const sla = cssReviewSlaLevel(
                        supplier.submittedToCssAt,
                        supplier.cssDecision === "PENDING" ? null : now,
                        now
                      );
                      const elapsed = cssReviewWorkingDaysElapsed(supplier.submittedToCssAt, null, now);
                      const due = supplier.submittedToCssAt
                        ? cssReviewDueDate(supplier.submittedToCssAt)
                        : null;
                      const rejected = supplier.cssDecision === "REJECTED";

                      return (
                        <tr
                          key={supplier.id}
                          className={pending ? SLA_ROW_CLASS[sla] : "opacity-60"}
                        >
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
                            {pending && due ? (
                              <span className={`text-caption ${SLA_TEXT_CLASS[sla]}`}>
                                {day(due)}
                                {slaLabel(sla, elapsed) ? ` · ${slaLabel(sla, elapsed)}` : ""}
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
                                approveAction={approveSupplierCosting}
                                rejectAction={rejectSupplierCosting}
                              />
                            ) : (
                              <div>
                                <Badge variant={rejected ? "danger" : supplier.cssDecision === "APPROVED" ? "success" : "neutral"}>
                                  {supplier.cssDecision === "PENDING"
                                    ? "Not sent yet"
                                    : supplier.cssDecision.toLowerCase()}
                                </Badge>
                                {supplier.cssNote && (
                                  <p className="text-caption mt-1 text-neutral-dark/60">
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
            </section>
          );
        })
      )}
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
