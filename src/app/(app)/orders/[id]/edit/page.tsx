import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { SAMPLE_CATEGORIES, SAMPLE_SOURCES } from "@/lib/categories";
import { canEditOrder, type OrderRequestType } from "@/lib/orders";
import type { OrderStatus } from "@/lib/types";
import { OrderForm, type OrderFormInitial, type SampleOption } from "../../order-form";
import { updateSampleOrder } from "../../actions";

// Phase 1 — the Admin editing a request while reviewing it. Same form as raising one, so
// the two can't drift on what a request contains.
export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdmin();

  const order = await prisma.sampleOrder.findUnique({
    where: { id },
    include: { ingredients: { select: { ingredientId: true } } },
  });
  if (!order) notFound();

  // A decided request isn't editable. Bouncing back to the detail page is friendlier than
  // a dead end, and the banner there explains the state.
  if (!canEditOrder(order.status as OrderStatus)) redirect(`/orders/${id}`);

  const [samples, functions, physicalForms, projects, supplierRows, sampleSupplierRows, ingredients] =
    await Promise.all([
      prisma.sample.findMany({
        where: { isDiscarded: false },
        select: {
          id: true,
          sampleCode: true,
          rmName: true,
          physicalForm: true,
          category: true,
          source: true,
          function: true,
          supplier: true,
          projectName: true,
          ingredients: { select: { ingredient: { select: { id: true, inciName: true } } } },
        },
        orderBy: { sampleCode: "asc" },
      }),
      prisma.sampleFunction.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
      prisma.physicalForm.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
      prisma.project.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
      prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
      prisma.sample.findMany({
        distinct: ["supplier"],
        select: { supplier: true },
        orderBy: { supplier: "asc" },
      }),
      prisma.ingredientListEntry.findMany({
        orderBy: { inciName: "asc" },
        select: { id: true, inciName: true, chemicalFamily: true },
      }),
    ]);

  const seen = new Set<string>();
  const supplierOptions: string[] = [];
  for (const name of [...supplierRows.map((r) => r.name), ...sampleSupplierRows.map((r) => r.supplier)]) {
    const key = (name ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    supplierOptions.push(name.trim());
  }
  supplierOptions.sort((a, b) => a.localeCompare(b));

  const options: SampleOption[] = samples.map((s) => ({
    id: s.id,
    sampleCode: s.sampleCode,
    rmName: s.rmName,
    ingredients: s.ingredients.map((i) => ({ id: i.ingredient.id, inciName: i.ingredient.inciName })),
    physicalForm: s.physicalForm,
    category: s.category,
    source: s.source,
    function: s.function,
    supplier: s.supplier,
    projectName: s.projectName,
  }));

  const initial: OrderFormInitial = {
    id: order.id,
    requestType: order.requestType as OrderRequestType,
    existingSampleId: order.existingSampleId ?? "",
    ingredientIds: order.ingredients.map((i) => i.ingredientId),
    // Free-text INCI is resolved into links on save, so the box starts empty on a reopen
    // rather than re-offering names that are already ticked below it.
    inciName: "",
    physicalForm: order.physicalForm ?? "",
    category: order.category ?? "",
    source: order.source ?? "",
    function: order.function ?? "",
    projectName: order.projectName ?? "",
    mainCharacteristic: order.mainCharacteristic ?? "",
    application: order.application ?? "",
    productFormat: order.productFormat ?? "",
    dosageOfUse: order.dosageOfUse ?? "",
    requiredQuantityG: order.requiredQuantityG ?? "",
    referenceLink: order.referenceLink ?? "",
    requiredDocuments: order.requiredDocuments ?? "",
    supplierName: order.supplierName ?? "",
    supplier1: order.supplier1 ?? "",
    supplier2: order.supplier2 ?? "",
    supplier3: order.supplier3 ?? "",
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href={`/orders/${id}`} className="text-caption text-neutral-dark/60 hover:underline">
          ← Back to the request
        </Link>
        <h1 className="text-page-title mt-1 text-neutral-dark">Edit request</h1>
        <p className="text-body mt-1 text-neutral-dark/60">
          Correct anything before approving. The Director attestation and supplier
          confirmation stay as the requester gave them — they aren&apos;t yours to re-make.
        </p>
      </div>

      <OrderForm
        samples={options}
        ingredients={ingredients}
        categories={SAMPLE_CATEGORIES}
        sources={SAMPLE_SOURCES}
        functions={functions.map((f) => f.name)}
        physicalForms={physicalForms.map((p) => p.name)}
        suppliers={supplierOptions}
        projects={projects.map((p) => p.name)}
        action={updateSampleOrder}
        initial={initial}
        submitLabel="Save changes"
        cancelHref={`/orders/${id}`}
      />
    </div>
  );
}
