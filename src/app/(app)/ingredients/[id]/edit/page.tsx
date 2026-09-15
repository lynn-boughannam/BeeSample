import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { IngredientForm } from "../../ingredient-form";
import { updateIngredient } from "../../actions";

export default async function EditIngredientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdmin();

  const [ingredient, chemicalFamilies, regulatoryFunctions] = await Promise.all([
    prisma.ingredientListEntry.findUnique({
      where: { id },
      include: { _count: { select: { sampleLinks: true } }, casNumbers: true },
    }),
    prisma.chemicalFamily.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    prisma.regulatoryFunction.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
  ]);

  if (!ingredient) notFound();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/ingredients" className="text-caption text-neutral-dark/60 hover:underline">
          ← Ingredient List
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <h1 className="text-page-title text-neutral-dark">{ingredient.inciName}</h1>
          <span className="text-body text-neutral-dark/60">{ingredient.uid}</span>
        </div>
        {ingredient._count.sampleLinks > 0 && (
          <p className="text-caption mt-1 text-neutral-dark/60">
            Referenced by {ingredient._count.sampleLinks} sample
            {ingredient._count.sampleLinks === 1 ? "" : "s"} — saved changes appear on each of
            them automatically.
          </p>
        )}
      </div>

      <IngredientForm
        action={updateIngredient}
        chemicalFamilies={chemicalFamilies.map((c) => c.name)}
        regulatoryFunctions={regulatoryFunctions.map((r) => r.name)}
        initial={{ ...ingredient, casNumbers: ingredient.casNumbers.map((c) => c.value) }}
        submitLabel="Save changes"
      />
    </div>
  );
}
