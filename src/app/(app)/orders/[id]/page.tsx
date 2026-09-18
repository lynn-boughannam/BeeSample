import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_SEQUENCE,
  type CssDecision,
  type OrderStatus,
} from "@/lib/types";
import { ORDER_REQUEST_TYPE_LABELS, type OrderRequestType } from "@/lib/orders";

// A submitted request is not a sample yet — it may never become one. This is where an
// order is read: the sample it was raised against (if any) is a reference on it, not a
// substitute for it.

const day = (d: Date) => d.toISOString().slice(0, 10);

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

const CSS_VARIANT: Record<CssDecision, "success" | "danger" | "neutral"> = {
  APPROVED: "success",
  REJECTED: "danger",
  PENDING: "neutral",
};

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await verifySession();
  const isAdmin = session.user.role === "ADMIN";

  const order = await prisma.sampleOrder.findUnique({
    where: { id },
    include: {
      orderedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      existingSample: { select: { id: true, sampleCode: true, rmName: true } },
      producedSample: { select: { id: true, sampleCode: true, rmName: true } },
      ingredients: { include: { ingredient: { select: { id: true, inciName: true } } } },
      suppliers: {
        orderBy: { position: "asc" },
        include: {
          documents: { orderBy: { uploadedAt: "asc" } },
          cssDecidedBy: { select: { name: true } },
        },
      },
    },
  });

  if (!order) notFound();
  // A Formulator sees only their own requests, matching the list.
  if (!isAdmin && order.orderedById !== session.user.id) notFound();

  const status = order.status as OrderStatus;
  const stepIndex = ORDER_STATUS_SEQUENCE.indexOf(status);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/orders" className="text-caption text-neutral-dark/60 hover:underline">
          ← Sample orders
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-page-title text-neutral-dark">
              {order.inciName?.trim() ||
                order.existingSample?.rmName ||
                "New raw material request"}
            </h1>
            <p className="text-body mt-0.5 text-neutral-dark/60">
              {ORDER_REQUEST_TYPE_LABELS[order.requestType as OrderRequestType] ??
                order.requestType}{" "}
              · raised by {order.orderedBy.name} on {day(order.createdAt)}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[status] ?? "neutral"}>
            {ORDER_STATUS_LABELS[status] ?? order.status}
          </Badge>
        </div>
      </div>

      {/* Where the request has reached. Rejected isn't on the track — it ends it. */}
      {status === "REJECTED" ? (
        <section className="rounded-lg border border-danger/30 bg-danger/5 p-4">
          <p className="text-body text-danger">
            This request was rejected
            {order.decidedAt ? ` on ${day(order.decidedAt)}` : ""}
            {order.approvedBy ? ` by ${order.approvedBy.name}` : ""}.
          </p>
          {order.rejectionReason && (
            <p className="text-body mt-1 text-neutral-dark/80">{order.rejectionReason}</p>
          )}
        </section>
      ) : (
        <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
          <h2 className="text-section-header mb-3 text-neutral-dark">Progress</h2>
          <ol className="flex flex-wrap gap-2">
            {ORDER_STATUS_SEQUENCE.map((step, i) => {
              const done = i < stepIndex;
              const current = i === stepIndex;
              return (
                <li
                  key={step}
                  aria-current={current ? "step" : undefined}
                  className={`text-caption rounded-full border px-3 py-1 ${
                    current
                      ? "border-brand-secondary bg-brand-primary/15 font-semibold text-neutral-dark"
                      : done
                        ? "border-success/40 bg-success/10 text-on-success"
                        : "border-neutral-dark/15 text-neutral-dark/45"
                  }`}
                >
                  {ORDER_STATUS_LABELS[step]}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-4 text-neutral-dark">Material</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="INCI">
            {order.ingredients.length === 0 && !order.inciName ? (
              <Missing />
            ) : (
              <span className="flex flex-wrap items-baseline gap-x-1.5">
                {order.ingredients.map((link) => (
                  <Link
                    key={link.ingredient.id}
                    href={`/ingredients/${link.ingredient.id}`}
                    className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
                  >
                    {link.ingredient.inciName}
                  </Link>
                ))}
                {order.inciName && (
                  <span className="text-neutral-dark/60">({order.inciName})</span>
                )}
              </span>
            )}
          </Field>
          <Field label="Category">{order.category || <Missing />}</Field>
          <Field label="Source">{order.source || <Missing />}</Field>
          <Field label="Physical form">{order.physicalForm || <Missing />}</Field>
          <Field label="Function">{order.function || <Missing />}</Field>
          <Field label="Project">{order.projectName || <Missing />}</Field>
        </dl>

        {/* The sample this was raised against — a reference, clearly labelled as such, so
            it can't be mistaken for the request having produced a library entry. */}
        {order.existingSample && (
          <p className="text-caption mt-4 text-neutral-dark/60">
            Raised against{" "}
            <Link
              href={`/library/${order.existingSample.id}`}
              className="font-medium text-neutral-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
            >
              {order.existingSample.sampleCode} · {order.existingSample.rmName}
            </Link>{" "}
            in the library.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-4 text-neutral-dark">This request</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Main characteristic">{order.mainCharacteristic || <Missing />}</Field>
          <Field label="Application">{order.application || <Missing />}</Field>
          <Field label="Product format">{order.productFormat || <Missing />}</Field>
          <Field label="Dosage of use">{order.dosageOfUse || <Missing />}</Field>
          <Field label="Required quantity">{order.requiredQuantityG || <Missing />}</Field>
          <Field label="Required documents">{order.requiredDocuments || <Missing />}</Field>
        </dl>
        {order.referenceLink && (
          <p className="text-caption mt-4 text-neutral-dark/70">
            Reference: {order.referenceLink}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-1 text-neutral-dark">Suppliers</h2>
        <p className="text-caption mb-4 text-neutral-dark/60">
          Documents, pricing and the CSS decision are recorded per supplier — they differ
          between options rather than applying to the request as a whole.
        </p>

        {order.suppliers.length === 0 ? (
          <SupplierNamesOnly order={order} />
        ) : (
          <ul className="space-y-3">
            {order.suppliers.map((s) => (
              <li
                key={s.id}
                className={`rounded-md border p-4 ${
                  s.isSelected ? "border-brand-secondary bg-brand-primary/[0.06]" : "border-neutral-dark/15"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-caption text-neutral-dark/50">#{s.position}</span>
                  <span className="text-body font-semibold text-neutral-dark">
                    {s.supplierName}
                  </span>
                  {s.isSelected && <Badge variant="info">Selected</Badge>}
                  <Badge variant={CSS_VARIANT[s.cssDecision as CssDecision] ?? "neutral"}>
                    CSS {s.cssDecision.toLowerCase()}
                  </Badge>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                  <Field label="Landed price">{s.landedPrice?.toString() ?? <Missing />}</Field>
                  <Field label="MOQ">{s.moq || <Missing />}</Field>
                  <Field label="Cost">{s.cost?.toString() ?? <Missing />}</Field>
                  <Field label="Shipping">{s.shippingCost?.toString() ?? <Missing />}</Field>
                  <Field label="Docs requested">
                    {s.documentsRequestedAt ? day(s.documentsRequestedAt) : <Missing />}
                  </Field>
                  <Field label="Docs due">
                    {s.documentsDueAt ? day(s.documentsDueAt) : <Missing />}
                  </Field>
                  <Field label="CSS decided">
                    {s.cssDecisionAt ? day(s.cssDecisionAt) : <Missing />}
                  </Field>
                  <Field label="Decided by">{s.cssDecidedBy?.name ?? <Missing />}</Field>
                </dl>

                {s.cssNote && (
                  <p className="text-caption mt-2 text-neutral-dark/70">{s.cssNote}</p>
                )}

                <p className="text-caption mt-2 text-neutral-dark/60">
                  {s.documents.length === 0
                    ? "No documents attached yet."
                    : `${s.documents.length} document${s.documents.length === 1 ? "" : "s"}: ${s.documents
                        .map((d) => d.fileName)
                        .join(", ")}`}
                </p>
              </li>
            ))}
          </ul>
        )}

        {order.shortSupplierListAcknowledged && (
          <p className="text-caption mt-3 text-neutral-dark/60">
            Submitted with fewer than 3 supplier options, confirmed by the requester.
            {order.shortSupplierListReason
              ? ` Reason: “${order.shortSupplierListReason}”`
              : ""}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-4 text-neutral-dark">Purchasing &amp; receipt</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="PR reference">{order.prNumber || <Missing />}</Field>
          <Field label="PR issued">{order.prIssuedAt ? day(order.prIssuedAt) : <Missing />}</Field>
          <Field label="Received">{order.receivedAt ? day(order.receivedAt) : <Missing />}</Field>
          <Field label="Sample code">{order.receivedSampleCode || <Missing />}</Field>
          <Field label="Library record">
            {order.producedSample ? (
              <Link
                href={`/library/${order.producedSample.id}`}
                className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
              >
                {order.producedSample.sampleCode}
              </Link>
            ) : (
              <span className="text-neutral-dark/45">Not received yet</span>
            )}
          </Field>
          <Field label="Director approval">
            {order.directorApprovalConfirmed ? "Confirmed at submission" : <Missing />}
          </Field>
        </dl>
      </section>
    </div>
  );
}

// Before the Supply Chain phase creates per-supplier records, the request still carries
// the names the requester gave. Showing those is better than an empty section that looks
// like the suppliers were never provided.
function SupplierNamesOnly({
  order,
}: {
  order: {
    supplierName: string | null;
    supplier1: string | null;
    supplier2: string | null;
    supplier3: string | null;
  };
}) {
  const named = [order.supplier1, order.supplier2, order.supplier3].filter(
    (s) => (s ?? "").trim() !== ""
  );
  const all = named.length > 0 ? named : [order.supplierName].filter(Boolean);

  if (all.length === 0) {
    return <p className="text-body text-neutral-dark/50">No suppliers named on this request.</p>;
  }

  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {all.map((name) => (
          <li
            key={name}
            className="rounded-md border border-neutral-dark/15 px-3 py-1.5 text-body text-neutral-dark"
          >
            {name}
          </li>
        ))}
      </ul>
      <p className="text-caption mt-2 text-neutral-dark/55">
        As named by the requester. Document requests and costing are recorded once Supply
        Chain picks this up.
      </p>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-neutral-dark/50">{label}</dt>
      <dd className="text-body text-neutral-dark">{children}</dd>
    </div>
  );
}

function Missing() {
  return <span className="text-neutral-dark/35">—</span>;
}
