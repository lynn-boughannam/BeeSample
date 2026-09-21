import Link from "next/link";
import { formatDay as day } from "@/lib/dates";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_SEQUENCE,
  type OrderStatus,
} from "@/lib/types";
import {
  ORDER_REQUEST_TYPE_LABELS,
  canEditOrder,
  isAwaitingAdminReview,
  isAwaitingSupplyChain,
  needsDocumentRequest,
  SUPPLIER_STAGE_LABELS,
  supplierStage,
  type OrderRequestType,
  type SupplierStage,
} from "@/lib/orders";
import { ReviewPanel } from "./review-panel";
import { approveOrder, rejectOrder } from "./review-actions";
import { DocumentPanel, type SupplierDocument } from "../../supply-chain/document-panel";
import { PricingForm } from "../../supply-chain/pricing-form";
import {
  attachSupplierDocuments,
  deleteSupplierDocument,
  saveSupplierPricing,
} from "../../supply-chain/actions";
import {
  SLA_ROW_CLASS,
  SLA_TEXT_CLASS,
  documentWorkingDaysElapsed,
  slaLabel,
  supplierDocumentDueDate,
  supplierDocumentSlaLevel,
} from "@/lib/working-days";

// A submitted request is not a sample yet — it may never become one. This is where an
// order is read: the sample it was raised against (if any) is a reference on it, not a
// substitute for it.


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

const STAGE_VARIANT: Record<SupplierStage, "neutral" | "warning" | "info" | "success" | "danger"> = {
  AWAITING_DOCUMENTS: "neutral",
  AWAITING_PRICING: "warning",
  PENDING_CSS: "info",
  CSS_APPROVED: "success",
  CSS_REJECTED: "danger",
};


export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const session = await verifySession();
  const role = session.user.role;
  const isAdmin = role === "ADMIN";
  // Supply Chain and CSS both act on a request and need to see what it's for — Samer
  // can't chase documents for a material he can't read the details of. Deciding stays
  // Admin-only; this is read access plus each role's own step.
  const worksOrders = isAdmin || role === "SUPPLY_CHAIN" || role === "CSS";
  const isSupplyChain = isAdmin || role === "SUPPLY_CHAIN";

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
          documents: {
            orderBy: { uploadedAt: "asc" },
            // Never select the bytes to render a list.
            select: {
              id: true,
              fileName: true,
              sizeBytes: true,
              uploadedAt: true,
              uploadedBy: { select: { name: true } },
            },
          },
          cssDecidedBy: { select: { name: true } },
        },
      },
    },
  });

  if (!order) notFound();
  // A Formulator sees only their own requests, matching the list.
  if (!worksOrders && order.orderedById !== session.user.id) notFound();

  const status = order.status as OrderStatus;
  const skipsDocuments = !needsDocumentRequest(order.requestType as OrderRequestType);
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

      {saved === "1" && (
        <p className="text-body rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-on-success">
          Changes saved.
        </p>
      )}

      {/* Phase 1. Only an Admin decides, and only while the request is still waiting for
          it — the action checks again regardless of what this renders. */}
      {isAdmin && isAwaitingAdminReview(status) && (
        <ReviewPanel
          orderId={order.id}
          canEdit={canEditOrder(status)}
          approveAction={approveOrder}
          rejectAction={rejectOrder}
        />
      )}

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

        {/* A repeat order from the same source needs nothing chased (Phase 2). */}
        {!skipsDocuments && isSupplyChain && isAwaitingSupplyChain(status) && (
          <p className="text-caption mb-3 text-neutral-dark/60">
            Logging a request starts a 7-working-day clock on that supplier.
          </p>
        )}
        {skipsDocuments && (
          <p className="text-body mb-3 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-on-success">
            Same supplier as before — documents are already on file, so none are chased.
          </p>
        )}

        {order.suppliers.length === 0 ? (
          <SupplierNamesOnly order={order} />
        ) : (
          <ul className="space-y-3">
            {order.suppliers.map((s) => {
              // The clock runs from approval — when this landed with Supply Chain — and
              // stops when the documents actually arrived.
              const done = s.documentsReceivedAt;
              const sla = supplierDocumentSlaLevel(order.decidedAt, done);
              const slaText = slaLabel(
                sla,
                documentWorkingDaysElapsed(order.decidedAt, done),
                Boolean(done)
              );
              const due = order.decidedAt ? supplierDocumentDueDate(order.decidedAt) : null;
              const stage = supplierStage({
                documentCount: s.documents.length,
                landedPrice: s.landedPrice,
                moq: s.moq,
                cssDecision: s.cssDecision,
              });
              return (
              <li
                key={s.id}
                className={`rounded-md border p-4 ${done ? "" : SLA_ROW_CLASS[sla]} ${
                  s.isSelected ? "border-brand-secondary bg-brand-primary/[0.06]" : "border-neutral-dark/15"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-caption text-neutral-dark/50">#{s.position}</span>
                  <span className="text-body font-semibold text-neutral-dark">
                    {s.supplierName}
                  </span>
                  {s.isSelected && <Badge variant="info">Selected</Badge>}
                  {/* Phase 3 — derived from the row, so it can't claim documents are in
                      while the list below shows none. */}
                  <Badge variant={STAGE_VARIANT[stage]}>{SUPPLIER_STAGE_LABELS[stage]}</Badge>
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
                    {due ? (
                      <span className={done ? "" : SLA_TEXT_CLASS[sla]}>
                        {day(due)}
                        {slaText ? ` · ${slaText}` : ""}
                      </span>
                    ) : (
                      <Missing />
                    )}
                  </Field>
                  <Field label="Docs in">{done ? day(done) : <Missing />}</Field>
                  <Field label="CSS decided">
                    {s.cssDecisionAt ? day(s.cssDecisionAt) : <Missing />}
                  </Field>
                  <Field label="Decided by">{s.cssDecidedBy?.name ?? <Missing />}</Field>
                </dl>

                {s.cssNote && (
                  <p className="text-caption mt-2 text-neutral-dark/70">{s.cssNote}</p>
                )}

                {/* Phase 2 — attaching sits with the details, so Samer reads what the
                    material is before handling its paperwork. Several per supplier is
                    normal: a COA and an SDS usually arrive together. */}
                {skipsDocuments ? (
                  <p className="text-caption mt-3 text-neutral-dark/60">
                    No documents chased — same supplier as before.
                  </p>
                ) : (
                  <DocumentPanel
                    orderSupplierId={s.id}
                    supplierName={s.supplierName}
                    documents={s.documents.map(
                      (d): SupplierDocument => ({
                        id: d.id,
                        fileName: d.fileName,
                        sizeBytes: d.sizeBytes,
                        uploadedAt: day(d.uploadedAt),
                        uploadedByName: d.uploadedBy?.name ?? null,
                      })
                    )}
                    canEdit={isSupplyChain && isAwaitingSupplyChain(status)}
                    attachAction={attachSupplierDocuments}
                    deleteAction={deleteSupplierDocument}
                  />
                )}

                {isSupplyChain && isAwaitingSupplyChain(status) && (
                  <PricingForm
                    orderSupplierId={s.id}
                    landedPrice={s.landedPrice?.toString() ?? ""}
                    moq={s.moq ?? ""}
                    action={saveSupplierPricing}
                  />
                )}
              </li>
              );
            })}
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
