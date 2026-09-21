import Link from "next/link";
import { formatDay as day } from "@/lib/dates";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import {
  SUPPLIER_STAGE_LABELS,
  needsDocumentRequest,
  orderLabel,
  supplierStage,
  type OrderRequestType,
  type SupplierStage,
} from "@/lib/orders";
import {
  SLA_ROW_CLASS,
  SLA_TEXT_CLASS,
  documentWorkingDaysElapsed,
  slaLabel,
  supplierDocumentDueDate,
  supplierDocumentSlaLevel,
  SUPPLIER_DOCUMENT_SLA_DAYS,
} from "@/lib/working-days";

// Phase 2/3 — the Supply Chain queue.
//
// One row per SUPPLIER, not per order: a request with three options is three separate
// pieces of work, chased and priced independently, and folding them into one row would
// make the count of outstanding work wrong.
//
// The columns are only what this job needs — what to ask for, from whom, by when, and what
// has come back. A material's category, function, physical form and project belong to
// formulation rather than procurement, and are one click away on the request itself.

const STAGE_VARIANT: Record<SupplierStage, "neutral" | "warning" | "info" | "success" | "danger"> = {
  AWAITING_DOCUMENTS: "neutral",
  AWAITING_PRICING: "warning",
  READY_TO_SUBMIT: "warning",
  PENDING_CSS: "info",
  CSS_APPROVED: "success",
  CSS_REJECTED: "danger",
};

// Most pressing first: work still outstanding outranks work already sent, and within that
// the longest-waiting comes first — the order someone would pick things up in anyway.
const STAGE_URGENCY: Record<SupplierStage, number> = {
  AWAITING_DOCUMENTS: 0,
  AWAITING_PRICING: 1,
  READY_TO_SUBMIT: 2,
  PENDING_CSS: 3,
  CSS_REJECTED: 4,
  CSS_APPROVED: 5,
};

export default async function SupplyChainPage() {
  const session = await verifySession();
  const role = session.user.role;
  // Supply Chain owns this queue; an Admin can work it when they're away.
  if (role !== "SUPPLY_CHAIN" && role !== "ADMIN") redirect("/dashboard");

  const orders = await prisma.sampleOrder.findMany({
    where: { status: "APPROVED_PENDING_SUPPLY_CHAIN" },
    select: {
      id: true,
      requestType: true,
      inciName: true,
      decidedAt: true,
      requiredQuantityG: true,
      requiredDocuments: true,
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
          documentsReceivedAt: true,
          cssDecision: true,
          // A count, not the rows: nothing here needs a filename, let alone the bytes.
          _count: { select: { documents: true } },
        },
      },
    },
    orderBy: { decidedAt: "asc" },
  });

  const now = new Date();

  const rows = orders
    .flatMap((order) => {
      const needsDocs = needsDocumentRequest(order.requestType as OrderRequestType);
      const due = order.decidedAt ? supplierDocumentDueDate(order.decidedAt) : null;

      return order.suppliers.map((supplier) => {
        const stage = supplierStage({
          documentCount: supplier._count.documents,
          landedPrice: supplier.landedPrice,
          moq: supplier.moq,
          cssDecision: supplier.cssDecision,
          submittedToCssAt: supplier.submittedToCssAt,
          needsDocuments: needsDocs,
        });

        // The document clock stops when the documents arrive — that is what it measures.
        // Not at submission: pricing is a separate step with no SLA of its own, and using
        // it here would leave a supplier reading overdue for paperwork already in hand.
        // A supplier whose paperwork is on file has no clock to run at all.
        const sla = needsDocs
          ? supplierDocumentSlaLevel(order.decidedAt, supplier.documentsReceivedAt, now)
          : ("NONE" as const);
        const elapsed = needsDocs
          ? documentWorkingDaysElapsed(order.decidedAt, supplier.documentsReceivedAt, now)
          : 0;

        return {
          key: supplier.id,
          orderId: order.id,
          label: orderLabel(order),
          needsDocs,
          position: supplier.position,
          supplierName: supplier.supplierName,
          documentCount: supplier._count.documents,
          landedPrice: supplier.landedPrice?.toString() ?? null,
          moq: supplier.moq,
          requiredQuantityG: order.requiredQuantityG,
          requiredDocuments: order.requiredDocuments,
          stage,
          sla,
          due,
          documentsIn: Boolean(supplier.documentsReceivedAt),
          slaText: slaLabel(sla, elapsed, Boolean(supplier.documentsReceivedAt)),
        };
      });
    })
    .sort((a, b) => {
      const byStage = STAGE_URGENCY[a.stage] - STAGE_URGENCY[b.stage];
      if (byStage !== 0) return byStage;
      // Oldest deadline first among equally urgent work.
      const aDue = a.due?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDue = b.due?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    });

  const outstanding = rows.filter((r) => r.stage !== "PENDING_CSS").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-page-title text-neutral-dark">Supply chain queue</h1>
        <p className="text-body mt-1 text-neutral-dark/60">
          {rows.length === 0
            ? "Nothing is waiting on Supply Chain."
            : `${outstanding} of ${rows.length} supplier option${
                rows.length === 1 ? "" : "s"
              } still need work. The ${SUPPLIER_DOCUMENT_SLA_DAYS}-working-day clock starts when a request is approved.`}
        </p>
      </div>

      {rows.length === 0 ? (
        <section className="rounded-lg border border-neutral-dark/10 bg-white p-8 text-center shadow-elevated">
          <p className="text-body text-neutral-dark/60">Nothing is waiting on Supply Chain.</p>
          <p className="text-caption mt-1 text-neutral-dark/45">
            Approved requests appear here, one row per supplier option.
          </p>
        </section>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-dark/10 bg-white shadow-elevated">
          <table className="w-full min-w-[60rem] text-left">
            <thead className="border-b border-neutral-dark/10 bg-neutral-dark/[0.02]">
              <tr>
                <Th>Request</Th>
                <Th>Supplier</Th>
                <Th>Stage</Th>
                <Th numeric>Docs</Th>
                <Th numeric>Landed price</Th>
                <Th>MOQ</Th>
                <Th>Asked for</Th>
                <Th>Due</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-dark/8">
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={`transition-colors duration-150 hover:bg-neutral-dark/[0.02] ${
                    row.documentsIn ? "" : SLA_ROW_CLASS[row.sla]
                  }`}
                >
                  <Td>
                    <Link
                      href={`/orders/${row.orderId}`}
                      className="text-body font-medium text-neutral-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
                    >
                      {row.label}
                    </Link>
                  </Td>
                  <Td>
                    <span className="text-caption mr-1.5 text-neutral-dark/45">
                      #{row.position}
                    </span>
                    <span className="text-body text-neutral-dark">{row.supplierName}</span>
                  </Td>
                  <Td>
                    <Badge variant={STAGE_VARIANT[row.stage]}>
                      {SUPPLIER_STAGE_LABELS[row.stage]}
                    </Badge>
                  </Td>
                  <Td numeric>
                    {row.needsDocs ? (
                      <span
                        className={
                          row.documentCount === 0 ? "text-neutral-dark/35" : "text-neutral-dark"
                        }
                      >
                        {row.documentCount}
                      </span>
                    ) : (
                      <span className="text-caption text-neutral-dark/45">on file</span>
                    )}
                  </Td>
                  <Td numeric>{row.landedPrice ?? <Dash />}</Td>
                  <Td>{row.moq || <Dash />}</Td>
                  {/* What to go and ask for: how much, and which papers. */}
                  <Td>
                    <span className="text-caption text-neutral-dark/70">
                      {row.requiredQuantityG ? `${row.requiredQuantityG} g` : "—"}
                      {row.requiredDocuments ? ` · ${row.requiredDocuments}` : ""}
                    </span>
                  </Td>
                  <Td>
                    {row.needsDocs && row.due ? (
                      <span className={`text-caption ${SLA_TEXT_CLASS[row.sla]}`}>
                        {day(row.due)}
                        {row.slaText ? ` · ${row.slaText}` : ""}
                      </span>
                    ) : (
                      <Dash />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-caption text-neutral-dark/55">
        Open a request to attach documents, enter a price and MOQ, or send a supplier to CSS.
      </p>
    </div>
  );
}

function Th({ children, numeric }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={`text-caption px-4 py-2.5 font-semibold text-neutral-dark/60 ${
        numeric ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, numeric }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <td className={`text-body px-4 py-3 align-middle ${numeric ? "text-right tabular-nums" : ""}`}>
      {children}
    </td>
  );
}

function Dash() {
  return <span className="text-neutral-dark/30">—</span>;
}
