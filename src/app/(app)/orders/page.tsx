import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import {
  ORDER_REQUEST_TYPE_LABELS,
  PLACEHOLDER_NOTE,
  orderLabel,
  type OrderRequestType,
} from "@/lib/orders";

// Submitted requests. The receiving/review step is a separate story, so nothing here acts
// on a request yet — this is the record AC7 asks for.

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const session = await verifySession();
  const { submitted } = await searchParams;

  // A Formulator sees their own requests; an Admin sees everything, since procurement
  // coordination is theirs.
  const isAdmin = session.user.role === "ADMIN";
  const orders = await prisma.sampleOrder.findMany({
    where: isAdmin ? {} : { orderedById: session.user.id },
    include: {
      orderedBy: { select: { name: true } },
      existingSample: { select: { id: true, sampleCode: true, rmName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-page-title text-neutral-dark">Sample orders</h1>
          <p className="text-body mt-1 text-neutral-dark/60">
            {isAdmin
              ? "Every request raised, newest first."
              : "Requests you have raised, newest first."}
          </p>
        </div>
        <Link
          href="/orders/new"
          className="text-body inline-flex items-center rounded-lg bg-brand-primary px-4 py-2 font-medium text-on-primary transition-[transform,opacity] duration-150 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary focus-visible:ring-offset-2 active:scale-[0.98]"
        >
          New request
        </Link>
      </div>

      {submitted === "1" && (
        <p className="text-body rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-on-success">
          Request submitted. Procurement can see it now.
        </p>
      )}

      {orders.length === 0 ? (
        <section className="rounded-lg border border-neutral-dark/10 bg-white p-8 text-center shadow-elevated">
          <p className="text-body text-neutral-dark/60">No requests yet.</p>
          <p className="text-caption mt-1 text-neutral-dark/45">
            Raise one when you need a new material, a new source, or a repeat order.
          </p>
        </section>
      ) : (
        <ul className="space-y-4">
          {orders.map((order) => (
            <li
              key={order.id}
              className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-body font-semibold text-neutral-dark">
                  {order.existingSample ? (
                    <Link
                      href={`/library/${order.existingSample.id}`}
                      className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
                    >
                      {orderLabel(order)}
                    </Link>
                  ) : (
                    orderLabel(order)
                  )}
                </span>
                <Badge variant="info">
                  {ORDER_REQUEST_TYPE_LABELS[order.requestType as OrderRequestType] ??
                    order.requestType}
                </Badge>
                <span className="text-caption ml-auto text-neutral-dark/60">
                  {order.orderedBy.name} · {day(order.createdAt)}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                <Detail label="Supplier" value={supplierSummary(order)} />
                <Detail label="Quantity" value={order.requiredQuantityG} />
                <Detail label="Application" value={order.application} />
                <Detail label="Product format" value={order.productFormat} />
                <Detail label="Dosage of use" value={order.dosageOfUse} />
                <Detail label="Documents" value={order.requiredDocuments} />
                <Detail label="Project" value={order.projectName} />
                <Detail label="Main characteristic" value={order.mainCharacteristic} />
              </dl>

              {order.referenceLink && (
                <p className="text-caption mt-3 text-neutral-dark/70">
                  Reference: {order.referenceLink}
                </p>
              )}

              {/* Worth showing: it records that a short supplier list was deliberate. */}
              {order.shortSupplierListAcknowledged && (
                <p className="text-caption mt-3 text-neutral-dark/55">
                  Submitted with fewer than 3 supplier options, confirmed by the requester.
                  {order.shortSupplierListReason ? (
                    <> Reason given: &ldquo;{order.shortSupplierListReason}&rdquo;</>
                  ) : (
                    <> No reason given.</>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-caption rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-on-warning">
        {PLACEHOLDER_NOTE}
      </p>
    </div>
  );
}

// A new-material request carries up to three options; the others name one supplier.
function supplierSummary(order: {
  supplierName: string | null;
  supplier1: string | null;
  supplier2: string | null;
  supplier3: string | null;
}): string | null {
  const three = [order.supplier1, order.supplier2, order.supplier3].filter(
    (s) => (s ?? "").trim() !== ""
  );
  if (three.length > 0) return three.join(", ");
  return order.supplierName;
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-caption text-neutral-dark/50">{label}</dt>
      <dd className="text-body text-neutral-dark">
        {value?.trim() ? value : <span className="text-neutral-dark/35">—</span>}
      </dd>
    </div>
  );
}
