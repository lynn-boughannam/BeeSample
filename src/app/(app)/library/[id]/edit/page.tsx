import Link from "next/link";
import { formatDay as day } from "@/lib/dates";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { allShelfCombinations } from "@/lib/categories";
import { loadShelfCellColors, loadShelfOccupancy, resolveShelfDefaults } from "@/lib/shelf";
import { SampleForm } from "../../sample-form";
import { updateSample } from "../actions";


export default async function EditSamplePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdmin();

  const [
    sample,
    ingredients,
    shelfDefaults,
    shelfOccupancy,
    shelfCellColors,
    functions,
    physicalForms,
    suppliers,
    projects,
  ] = await Promise.all([
      prisma.sample.findUnique({
        where: { id },
        include: { ingredients: { select: { ingredientId: true } } },
      }),
      prisma.ingredientListEntry.findMany({
        orderBy: { inciName: "asc" },
        select: { id: true, inciName: true, chemicalFamily: true },
      }),
      resolveShelfDefaults(allShelfCombinations()),
      // This sample is excluded: it doesn't collide with the address it already holds.
      loadShelfOccupancy(id),
      loadShelfCellColors(),
      prisma.sampleFunction.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
      prisma.physicalForm.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
      prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
      prisma.project.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    ]);

  if (!sample) notFound();
  // A discarded sample is a historical record; editing it would rewrite history.
  if (sample.isDiscarded) redirect(`/library/${id}`);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href={`/library/${id}`} className="text-caption text-neutral-dark/60 hover:underline">
          ← {sample.sampleCode}
        </Link>
        <h1 className="text-page-title mt-1 text-neutral-dark">Edit sample</h1>
      </div>

      <SampleForm
        action={updateSample}
        ingredients={ingredients}
        shelfDefaults={shelfDefaults}
        shelfOccupancy={shelfOccupancy}
        shelfCellColors={shelfCellColors}
        functions={functions.map((f) => f.name)}
        physicalForms={physicalForms.map((p) => p.name)}
        suppliers={suppliers.map((s) => s.name)}
        projects={projects.map((p) => p.name)}
        initial={{
          id: sample.id,
          sampleCode: sample.sampleCode,
          rmName: sample.rmName,
          category: sample.category,
          fragranceOrientation: sample.fragranceOrientation ?? "",
          function: sample.function,
          physicalForm: sample.physicalForm,
          source: sample.source,
          supplier: sample.supplier,
          projectName: sample.projectName ?? "",
          hazardClass: sample.hazardClass ?? "",
          receptionDate: day(sample.receptionDate),
          expiryDate: day(sample.expiryDate),
          receivedQtyG: sample.totalQtyG.toString(),
          receivedQtyPcs: sample.receivedQtyPcs != null ? String(sample.receivedQtyPcs) : "",
          netWeightG: sample.netWeightG != null ? sample.netWeightG.toString() : "",
          batchLot: sample.batchLot ?? "",
          documentAvailability: sample.documentAvailability ?? "",
          shelfLetter: sample.shelfLetter,
          shelfLevel: String(sample.shelfLevel),
          shelfSublevel: sample.shelfSublevel != null ? String(sample.shelfSublevel) : "",
          ingredientIds: sample.ingredients.map((i) => i.ingredientId),
        }}
        submitLabel="Save changes"
        cancelHref={`/library/${id}`}
      />
    </div>
  );
}
