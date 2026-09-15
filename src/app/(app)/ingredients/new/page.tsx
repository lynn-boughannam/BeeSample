import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { IngredientForm } from "../ingredient-form";
import { createIngredient } from "../actions";

export default async function NewIngredientPage() {
  await requireAdmin();

  const [chemicalFamilies, regulatoryFunctions] = await Promise.all([
    prisma.chemicalFamily.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    prisma.regulatoryFunction.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
  ]);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/ingredients" className="text-caption text-neutral-dark/60 hover:underline">
          ← Ingredient List
        </Link>
        <h1 className="text-page-title mt-1 text-neutral-dark">Add ingredient</h1>
      </div>

      <IngredientForm
        action={createIngredient}
        chemicalFamilies={chemicalFamilies.map((c) => c.name)}
        regulatoryFunctions={regulatoryFunctions.map((r) => r.name)}
        submitLabel="Save ingredient"
      />
    </div>
  );
}
