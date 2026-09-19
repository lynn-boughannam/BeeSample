import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/types";
import {
  ORDER_REQUEST_TYPES,
  ORDER_REQUEST_TYPE_LABELS,
  PLACEHOLDER_NOTE,
  orderLabel,
  type OrderRequestType,
} from "@/lib/orders";
import { OrderFilters } from "./order-filters";

// Submitted requests. The receiving/review step is a separate story, so nothing here acts
// on a request yet — but status is shown, because a queue you can't see the state of is
// just a list.

const day = (d: Date) => d.toISOString().slice(0, 10);

// Colour tracks what the status means, not where it sits in the sequence: waiting on
// someone is amber, moving is blue, finished is green, dead is red.
const STATUS_VARIANT: Record<OrderStatus, "info" | "success" | "danger" | "warning" | "neutral"> = {
  SUBMITTED: "info",
  REJECTED: "danger",
  APPROVED_PENDING_SUPPLY_CHAIN: "warning",
  SUPPLIER_SELECTED: "info",
  COSTING_SUBMITTED_PENDING_FORMULATOR: "warning",
  FORMULATOR_APPROVED_PENDING_PR: "warning",
  PR_ISSUED_AWAITING_RECEIPT: "info",
  RECEIVED: "success",
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; q?: string; type?: string; status?: string }>;
}) {
  const session = await verifySession();
  const params = await searchParams;

  const query = (params.q ?? "").trim();
  const type = ORDER_REQUEST_TYPES.includes(params.type as OrderRequestType)
    ? (params.type as OrderRequestType)
    : "";
  const status = ORDER_STATUSES.includes(params.status as (typeof ORDER_STATUSES)[number])
    ? params.status!
    : "";

  // A Formulator sees their own requests; an Admin sees everything, since procurement
  // coordination is theirs.
  const isAdmin = session.user.role === "ADMIN";

  // Searching covers every field someone would recognise a request by, including the
  // sample it was raised against and all three supplier boxes. No `mode: "insensitive"` —
  // the sqlserver connector doesn't support it, and the collation is already case-blind.
  const where: Prisma.SampleOrderWhereInput = {
    ...(isAdmin ? {} : { orderedById: session.user.id }),
    ...(type ? { requestType: type } : {}),
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { inciName: { contains: query } },
            { supplierName: { contains: query } },
            { supplier1: { contains: query } },
            { supplier2: { contains: query } },
            { supplier3: { contains: query } },
            { projectName: { contains: query } },
            { category: { contains: query } },
            { application: { contains: query } },
            { orderedBy: { name: { contains: query } } },
            { existingSample: { sampleCode: { contains: query } } },
            { existingSample: { rmName: { contains: query } } },
            { ingredients: { some: { ingredient: { inciName: { contains: query } } } } },
          ],
        }
      : {}),
  };

  const [orders, totalCount] = await Promise.all([
    prisma.sampleOrder.findMany({
      where,
      include: {
        orderedBy: { select: { name: true } },
        existingSample: { select: { id: true, sampleCode: true, rmName: true } },
        ingredients: { include: { ingredient: { select: { id: true, inciName: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // The unfiltered count, so the filter row can say how much is being hidden.
    prisma.sampleOrder.count({ where: isAdmin ? {} : { orderedById: session.user.id } }),
  ]);

  // Phase 1 — the review queue. Only an Admin acts on it, so only they are told about it.
  const awaitingReview = isAdmin
    ? await prisma.sampleOrder.count({ where: { status: "SUBMITTED" } })
    : 0;

  const filtered = Boolean(query || type || status);

  return (
    <div className="space-y-6">
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

      {params.submitted === "1" && (
        <p className="text-body rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-on-success">
          Request submitted. Procurement can see it now.
        </p>
      )}

      {awaitingReview > 0 && status !== "SUBMITTED" && (
        <Link
          href="/orders?status=SUBMITTED"
          className="text-body flex flex-wrap items-center gap-2 rounded-lg border border-brand-secondary/30 bg-brand-primary/[0.08] px-4 py-3 text-neutral-dark transition-colors duration-150 hover:bg-brand-primary/[0.14] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
        >
          <span className="font-semibold">
            {awaitingReview} request{awaitingReview === 1 ? "" : "s"} awaiting your review
          </span>
          <span className="text-neutral-dark/60">— open the queue</span>
        </Link>
      )}

      <OrderFilters q={query} type={type} status={status} />

      {totalCount > 0 && (
        <p className="text-caption text-neutral-dark/55">
          Showing {orders.length} of {totalCount} request{totalCount === 1 ? "" : "s"}
          {filtered && " (filtered)"}.
        </p>
      )}

      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Raised</TableHeaderCell>
            <TableHeaderCell>Request</TableHeaderCell>
            <TableHeaderCell>Type</TableHeaderCell>
            <TableHeaderCell>INCI</TableHeaderCell>
            <TableHeaderCell>Supplier</TableHeaderCell>
            <TableHeaderCell className="text-right">Quantity</TableHeaderCell>
            <TableHeaderCell>Project</TableHeaderCell>
            <TableHeaderCell>Requested by</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {orders.length === 0 ? (
            <TableEmpty
              colSpan={9}
              message={
                totalCount === 0
                  ? "No requests yet. Raise one when you need a new material, a new source, or a repeat order."
                  : "No requests match these filters."
              }
            />
          ) : (
            orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell>{day(order.createdAt)}</TableCell>
                <TableCell>
                  {/* The request, not the sample it was raised against. A submitted order
                      isn't a library entry and may never become one — linking to the
                      source sample made it look as though it already had. */}
                  <Link
                    href={`/orders/${order.id}`}
                    className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
                  >
                    {orderLabel(order)}
                  </Link>
                  {order.existingSample && (
                    <span className="text-caption block text-neutral-dark/50">
                      against{" "}
                      <Link
                        href={`/library/${order.existingSample.id}`}
                        className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
                      >
                        {order.existingSample.sampleCode}
                      </Link>
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {ORDER_REQUEST_TYPE_LABELS[order.requestType as OrderRequestType] ??
                    order.requestType}
                </TableCell>
                <TableCell>
                  {/* Linked records, so a name here always matches the ingredient it
                      points at. Free-text INCI trails behind in brackets. */}
                  <span className="flex flex-wrap items-baseline gap-x-1.5">
                    {order.ingredients.map((link, i) => (
                      <Link
                        key={link.ingredient.id}
                        href={`/ingredients/${link.ingredient.id}`}
                        className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
                      >
                        {link.ingredient.inciName}
                        {i < order.ingredients.length - 1 ? "," : ""}
                      </Link>
                    ))}
                    {order.inciName && (
                      <span className="text-neutral-dark/60">({order.inciName})</span>
                    )}
                    {order.ingredients.length === 0 && !order.inciName && dash}
                  </span>
                </TableCell>
                <TableCell>
                  <SupplierCell order={order} />
                </TableCell>
                <TableCell className="text-right">{order.requiredQuantityG ?? dash}</TableCell>
                <TableCell>{order.projectName ?? dash}</TableCell>
                <TableCell>{order.orderedBy.name}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[order.status as OrderStatus] ?? "neutral"}>
                    {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <p className="text-caption rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-on-warning">
        {PLACEHOLDER_NOTE}
      </p>
    </div>
  );
}

const dash = <span className="text-neutral-dark/35">—</span>;

// A new-material request carries up to three options; the others name one supplier. Where
// fewer than three were given, the reason is carried on the row rather than dropped —
// it's the whole point of having asked for it.
function SupplierCell({
  order,
}: {
  order: {
    supplierName: string | null;
    supplier1: string | null;
    supplier2: string | null;
    supplier3: string | null;
    shortSupplierListAcknowledged: boolean;
    shortSupplierListReason: string | null;
  };
}) {
  const three = [order.supplier1, order.supplier2, order.supplier3].filter(
    (s) => (s ?? "").trim() !== ""
  );
  const names = three.length > 0 ? three.join(", ") : order.supplierName;

  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span>{names ?? dash}</span>
      {order.shortSupplierListAcknowledged && (
        <span
          className="text-caption text-warning"
          title={
            order.shortSupplierListReason
              ? `${three.length} of 3 — ${order.shortSupplierListReason}`
              : `${three.length} of 3 — no reason recorded`
          }
        >
          {three.length} of 3
        </span>
      )}
    </span>
  );
}
