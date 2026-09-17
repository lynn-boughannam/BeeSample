import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { SAMPLE_CATEGORIES, SAMPLE_SOURCES } from "@/lib/categories";
import { OrderForm, type SampleOption } from "../order-form";
import { createSampleOrder } from "../actions";

// SLT-58 step 1. Open to Formulators and Admins alike — raising a request isn't an
// administrative act.
export default async function NewOrderPage() {
  await verifySession();

  const [samples, functions, physicalForms, projects, supplierRows, ingredients] = await Promise.all([
    // The live library is the catalogue for an "existing sample" request. Discarded
    // samples are excluded: re-ordering from a record we've retired is not the intent.
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
    // Distinct Sample.supplier values rather than the managed Supplier table, per the
    // story: the list should reflect who has actually supplied something.
    prisma.sample.findMany({
      distinct: ["supplier"],
      select: { supplier: true },
      orderBy: { supplier: "asc" },
    }),
    // The INCI master list, so a request links to real ingredient records.
    prisma.ingredientListEntry.findMany({
      orderBy: { inciName: "asc" },
      select: { id: true, inciName: true, chemicalFamily: true },
    }),
  ]);

  const options: SampleOption[] = samples.map((s) => ({
    id: s.id,
    sampleCode: s.sampleCode,
    rmName: s.rmName,
    // Carried with their ids so the form can link each INCI back to its record.
    ingredients: s.ingredients.map((i) => ({ id: i.ingredient.id, inciName: i.ingredient.inciName })),
    physicalForm: s.physicalForm,
    category: s.category,
    source: s.source,
    function: s.function,
    supplier: s.supplier,
    projectName: s.projectName,
  }));

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/orders" className="text-caption text-neutral-dark/60 hover:underline">
          ← Sample orders
        </Link>
        <h1 className="text-page-title mt-1 text-neutral-dark">New sample order request</h1>
        <p className="text-body mt-1 text-neutral-dark/60">
          Tell procurement what you need. Start by choosing the kind of request — that
          decides what gets pre-filled.
        </p>
      </div>

      <OrderForm
        samples={options}
        ingredients={ingredients}
        categories={SAMPLE_CATEGORIES}
        sources={SAMPLE_SOURCES}
        functions={functions.map((f) => f.name)}
        physicalForms={physicalForms.map((p) => p.name)}
        suppliers={supplierRows.map((s) => s.supplier).filter(Boolean)}
        projects={projects.map((p) => p.name)}
        action={createSampleOrder}
      />
    </div>
  );
}
