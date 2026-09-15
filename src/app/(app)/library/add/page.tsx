import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { allShelfCombinations } from "@/lib/categories";
import { loadShelfCellColors, loadShelfOccupancy, resolveShelfDefaults } from "@/lib/shelf";
import { SampleForm } from "../sample-form";
import { createSample } from "./actions";

export default async function AddSamplePage() {
  await requireAdmin();

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
      // Resolved up front for every source/category/orientation combination so the shelf
      // row can re-default instantly on change, with no round-trip per selection.
      resolveShelfDefaults(allShelfCombinations()),
      // Which sublevels each cell has already used, so the form can show the address the
      // sample will actually get rather than just "auto".
      loadShelfOccupancy(),
      // The shelf plan's colour per cell, so the form's swatch tracks the row and
      // level actually selected rather than the category.
      loadShelfCellColors(),
      prisma.sampleFunction.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
      prisma.physicalForm.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
      prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
      prisma.project.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    ]);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/library" className="text-caption text-neutral-dark/60 hover:underline">
          ← Sample Library
        </Link>
        <h1 className="text-page-title mt-1 text-neutral-dark">Add sample</h1>
      </div>

      <SampleForm
        action={createSample}
        ingredients={ingredients}
        shelfDefaults={shelfDefaults}
        shelfOccupancy={shelfOccupancy}
        shelfCellColors={shelfCellColors}
        functions={functions.map((f) => f.name)}
        physicalForms={physicalForms.map((p) => p.name)}
        suppliers={suppliers.map((s) => s.name)}
        projects={projects.map((p) => p.name)}
        submitLabel="Save sample"
        cancelHref="/library"
      />
    </div>
  );
}
