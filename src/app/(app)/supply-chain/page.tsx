import Link from "next/link";
import { formatDay as day } from "@/lib/dates";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import {
  ORDER_REQUEST_TYPE_LABELS,
  needsDocumentRequest,
  orderLabel,
  type OrderRequestType,
} from "@/lib/orders";
import {
  SLA_ROW_CLASS,
  SLA_TEXT_CLASS,
  slaLabel,
  supplierDocumentSlaLevel,
  workingDaysBetween,
  SUPPLIER_DOCUMENT_SLA_DAYS,
} from "@/lib/working-days";
import { RequestDocumentsButton } from "./request-button";
import { requestSupplierDocuments } from "./actions";

// Phase 2 — the Supply Chain queue. Approved requests, each with its supplier options and
// what still needs chasing.


export default async function SupplyChainPage() {
  const session = await verifySession();
  const role = session.user.role;
  // Supply Chain owns this queue; an Admin can work it when they're away.
  if (role !== "SUPPLY_CHAIN" && role !== "ADMIN") redirect("/dashboard");

  const orders = await prisma.sampleOrder.findMany({
    where: { status: "APPROVED_PENDING_SUPPLY_CHAIN" },
    include: {
      orderedBy: { select: { name: true } },
      existingSample: { select: { sampleCode: true, rmName: true } },
      suppliers: { orderBy: { position: "asc" } },
    },
    orderBy: { decidedAt: "asc" },
  });

  const now = new Date();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-page-title text-neutral-dark">Supply chain queue</h1>
        <p className="text-body mt-1 text-neutral-dark/60">
          Approved requests waiting on supplier documents. Logging a request starts a{" "}
          {SUPPLIER_DOCUMENT_SLA_DAYS}-working-day clock on that supplier.
        </p>
      </div>

      {orders.length === 0 ? (
        <section className="rounded-lg border border-neutral-dark/10 bg-white p-8 text-center shadow-elevated">
          <p className="text-body text-neutral-dark/60">Nothing is waiting on Supply Chain.</p>
          <p className="text-caption mt-1 text-neutral-dark/45">
            Approved requests appear here for their supplier documents to be chased.
          </p>
        </section>
      ) : (
        orders.map((order) => {
          const skipsDocuments = !needsDocumentRequest(order.requestType as OrderRequestType);

          return (
            <section
              key={order.id}
              className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <Link
                    href={`/orders/${order.id}`}
                    className="text-section-header text-neutral-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
                  >
                    {orderLabel(order)}
                  </Link>
                  <p className="text-caption mt-0.5 text-neutral-dark/60">
                    {ORDER_REQUEST_TYPE_LABELS[order.requestType as OrderRequestType]} · raised by{" "}
                    {order.orderedBy.name}
                    {order.decidedAt ? ` · approved ${day(order.decidedAt)}` : ""}
                  </p>
                </div>
                {skipsDocuments && (
                  <Badge variant="success">No documents needed</Badge>
                )}
              </div>

              {/* A repeat order from the same source already has its paperwork, so the step
                  is shown as skipped rather than offered and refused. */}
              {skipsDocuments ? (
                <p className="text-body mt-3 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-on-success">
                  Same supplier as before — documents are already on file. This request is
                  ready for costing.
                </p>
              ) : order.suppliers.length === 0 ? (
                <p className="text-body mt-3 text-neutral-dark/50">
                  No supplier options were recorded on this request.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-neutral-dark/8 rounded-md border border-neutral-dark/10">
                  {order.suppliers.map((supplier) => {
                    const level = supplierDocumentSlaLevel(supplier.documentsRequestedAt, now);
                    const elapsed = supplier.documentsRequestedAt
                      ? workingDaysBetween(supplier.documentsRequestedAt, now)
                      : 0;
                    const label = slaLabel(level, elapsed);

                    return (
                      <li
                        key={supplier.id}
                        className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 ${SLA_ROW_CLASS[level]}`}
                      >
                        <span className="text-caption text-neutral-dark/45">
                          #{supplier.position}
                        </span>
                        <span className="text-body font-medium text-neutral-dark">
                          {supplier.supplierName}
                        </span>

                        {supplier.documentsRequestedAt ? (
                          <>
                            <span className="text-caption text-neutral-dark/60">
                              requested {day(supplier.documentsRequestedAt)}
                            </span>
                            <span className={`text-caption ${SLA_TEXT_CLASS[level]}`}>
                              due{" "}
                              {supplier.documentsDueAt ? day(supplier.documentsDueAt) : "—"}
                              {label ? ` · ${label}` : ""}
                            </span>
                          </>
                        ) : (
                          <span className="ml-auto">
                            <RequestDocumentsButton
                              orderSupplierId={supplier.id}
                              supplierName={supplier.supplierName}
                              action={requestSupplierDocuments}
                            />
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
