import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { allShelfCombinations } from "@/lib/categories";
import { loadShelfCellColors, loadShelfOccupancy, resolveShelfDefaults } from "@/lib/shelf";
import { canReceiveOrder, checkReceiptReady, orderLabel, receptionMode } from "@/lib/orders";
import { shelfAddress } from "@/lib/categories";
import { SampleForm } from "../../../library/sample-form";
import { RestockForm } from "./restock-form";
import { receiveOrder, receiveIntoExistingStock } from "./actions";

// Phase 9 — the request becomes a sample.
//
// The same form as Add Sample, prefilled from the request. Reception is not a lighter kind
// of sample entry: what arrives needs pieces and a shelf slot exactly as a directly-entered
// sample does, and reusing the form is what guarantees it gets them.

export default async function ReceiveOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;
  if (!canReceiveOrder(session.user.role)) notFound();

  const order = await prisma.sampleOrder.findUnique({
    where: { id },
    include: {
      existingSample: {
        select: {
          id: true,
          sampleCode: true,
          rmName: true,
          category: true,
          source: true,
          isDiscarded: true,
          totalQtyG: true,
          shelfLetter: true,
          shelfLevel: true,
          shelfSublevel: true,
        },
      },
      ingredients: { select: { ingredientId: true } },
      suppliers: {
        where: { isSelected: true },
        select: { supplierName: true, cost: true, shippingCost: true },
      },
    },
  });
  if (!order) notFound();

  // The gate is the same one the action re-checks; this only decides what to render.
  const ready = checkReceiptReady(order);
  // A repeat order of the same material from the same supplier adds to the sample already
  // on the shelf. Anything else — a new material, or the same one from a different supplier
  // — becomes its own entry, because Sample.supplier is a single value and mixing two
  // provenances into one pile would make it a lie.
  const restocking = receptionMode(order) === "RESTOCK" && order.existingSample;

  const [
    ingredients,
    shelfDefaults,
    shelfOccupancy,
    shelfCellColors,
    functions,
    physicalForms,
    suppliers,
    projects,
  ] = await Promise.all([
    prisma.ingredientListEntry.findMany({
      orderBy: { inciName: "asc" },
      select: { id: true, inciName: true, chemicalFamily: true },
    }),
    resolveShelfDefaults(allShelfCombinations()),
    loadShelfOccupancy(),
    loadShelfCellColors(),
    prisma.sampleFunction.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    prisma.physicalForm.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    prisma.project.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
  ]);

  const chosen = order.suppliers[0] ?? null;
  // A supplier the request names but the reference list doesn't hold would silently blank
  // the dropdown, so it is offered here and saved with the sample like any other.
  const supplierNames = suppliers.map((s) => s.name);
  const supplierOptions =
    chosen && !supplierNames.includes(chosen.supplierName)
      ? [...supplierNames, chosen.supplierName].sort((a, b) => a.localeCompare(b))
      : supplierNames;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link
          href={`/orders/${order.id}`}
          className="text-caption text-neutral-dark/60 hover:underline"
        >
          ← {orderLabel(order)}
        </Link>
        <h1 className="text-page-title mt-1 text-neutral-dark">
          {restocking ? "Receive into stock" : "Receive into the library"}
        </h1>
        <p className="text-body mt-1 text-neutral-dark/60">
          {restocking
            ? "A repeat order of a material already on the shelf. Record what arrived and it joins that sample's stock."
            : "What the request asked for is filled in below. Check it against the delivery, enter what actually arrived, and saving creates the sample."}
        </p>
      </div>

      {!ready.ok ? (
        <section className="rounded-lg border border-neutral-dark/15 bg-neutral-dark/[0.02] p-5">
          <p className="text-body text-neutral-dark/70">{ready.reason}</p>
          {order.producedSampleId && (
            <Link
              href={`/library/${order.producedSampleId}`}
              className="text-body mt-2 inline-block font-medium text-neutral-dark underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
            >
              Open the sample it produced
            </Link>
          )}
        </section>
      ) : restocking && order.existingSample ? (
        <RestockForm
          orderId={order.id}
          sampleCode={order.existingSample.sampleCode}
          rmName={order.existingSample.rmName}
          currentTotalG={order.existingSample.totalQtyG?.toString() ?? "0"}
          shelfAddress={
            order.existingSample.shelfLetter && order.existingSample.shelfLevel != null
              ? shelfAddress(
                  order.existingSample.shelfLetter,
                  order.existingSample.shelfLevel,
                  order.existingSample.shelfSublevel
                )
              : "no recorded location"
          }
          requestedQuantityG={order.requiredQuantityG}
          action={receiveIntoExistingStock}
        />
      ) : (
        <SampleForm
          // A reception creates a sample; the prefill below is not an edit.
          mode="CREATE"
          action={receiveOrder}
          ingredients={ingredients}
          shelfDefaults={shelfDefaults}
          shelfOccupancy={shelfOccupancy}
          shelfCellColors={shelfCellColors}
          functions={functions.map((f) => f.name)}
          physicalForms={physicalForms.map((p) => p.name)}
          suppliers={supplierOptions}
          projects={projects.map((p) => p.name)}
          // Carried forward from the request. The quantity boxes are deliberately left
          // empty: entering what arrived IS the check, and prefilling them with what was
          // asked for would turn the comparison into something that always agrees.
          initial={{
            // No sample to edit — this form is creating one.
            id: "",
            sampleCode: "",
            rmName: order.inciName?.trim() || order.existingSample?.rmName || "",
            category: order.category ?? order.existingSample?.category ?? "",
            fragranceOrientation: "",
            function: order.function ?? "",
            physicalForm: order.physicalForm ?? "",
            source: order.source ?? order.existingSample?.source ?? "",
            supplier: chosen?.supplierName ?? order.supplierName ?? "",
            projectName: order.projectName ?? "",
            hazardClass: "",
            receptionDate: "",
            expiryDate: "",
            receivedQtyG: "",
            receivedQtyPcs: "",
            netWeightG: "",
            batchLot: "",
            documentAvailability: "",
            shelfLetter: "",
            shelfLevel: "",
            shelfSublevel: "",
            ingredientIds: order.ingredients.map((i) => i.ingredientId),
          }}
          requestedQuantityG={order.requiredQuantityG}
          orderId={order.id}
          submitLabel="Save sample"
          cancelHref={`/orders/${order.id}`}
        />
      )}
    </div>
  );
}
