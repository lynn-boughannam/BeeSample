"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { nextIngredientCode } from "@/lib/ingredient-code";
import { IngredientSchema, UpdateIngredientSchema } from "@/lib/validation";
import { toBool } from "@/lib/ingredients";

export type IngredientActionState =
  | { fieldErrors?: Record<string, string>; formError?: string }
  | undefined;

function readForm(formData: FormData) {
  return {
    inciName: formData.get("inciName"),
    molecularFormula: formData.get("molecularFormula"),
    molecularWeight: formData.get("molecularWeight"),
    chemicalFamily: formData.get("chemicalFamily"),
    casNumbers: formData.getAll("casNumbers"),
    regulatoryFunction: formData.get("regulatoryFunction"),
    euRegulation: formData.get("euRegulation"),
    euAnnex: formData.get("euAnnex"),
    restriction: formData.get("restriction"),
    euOpinion: formData.get("euOpinion"),
    chinaListed: formData.get("chinaListed"),
    endocrineDisruptor: formData.get("endocrineDisruptor"),
    cmr: formData.get("cmr"),
    dermalAbsorption: formData.get("dermalAbsorption"),
    noael: formData.get("noael"),
    biodegradability: formData.get("biodegradability"),
    pbt: formData.get("pbt"),
    aquaticToxicity: formData.get("aquaticToxicity"),
    aquaticHazardStatements: formData.get("aquaticHazardStatements"),
    yukaRating: formData.get("yukaRating"),
    inciBeautyRating: formData.get("inciBeautyRating"),
    beeslineRating: formData.get("beeslineRating"),
    comments: formData.get("comments"),
  };
}

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
  }
  return fieldErrors;
}

// The Yes/No selects post "YES"/"NO"/"" and are stored as nullable booleans; everything
// else is already in its stored shape after parsing.
function toRow<T extends { casNumbers: string[] }>(data: T, formData: FormData) {
  // casNumbers is written through its own relation, so it's dropped from the scalar row.
  const { casNumbers: _casNumbers, ...scalars } = data;
  return {
    ...scalars,
    euRegulation: toBool(formData.get("euRegulation")),
    chinaListed: toBool(formData.get("chinaListed")),
    pbt: toBool(formData.get("pbt")),
    aquaticToxicity: toBool(formData.get("aquaticToxicity")),
  };
}

export async function createIngredient(
  _prev: IngredientActionState,
  formData: FormData
): Promise<IngredientActionState> {
  await requireAdmin();

  const parsed = IngredientSchema.safeParse(readForm(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };

  const uid = await nextIngredientCode();

  try {
    await prisma.ingredientListEntry.create({
      data: {
        ...toRow(parsed.data, formData),
        uid,
        casNumbers: { create: parsed.data.casNumbers.map((value) => ({ value })) },
      },
    });
  } catch {
    return { formError: "Could not save the ingredient. Try again." };
  }

  revalidatePath("/ingredients");
  redirect("/ingredients");
}

export async function updateIngredient(
  _prev: IngredientActionState,
  formData: FormData
): Promise<IngredientActionState> {
  await requireAdmin();

  const parsed = UpdateIngredientSchema.safeParse({
    ...readForm(formData),
    id: formData.get("id"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };

  const { id, ...rest } = parsed.data;

  try {
    // Samples reference ingredients by foreign key, so nothing else needs updating —
    // every sample showing this ingredient picks the new values up automatically.
    await prisma.$transaction(async (tx) => {
      await tx.ingredientListEntry.update({ where: { id }, data: toRow(rest, formData) });
      // Simplest correct reconciliation for a small label set: clear and rewrite.
      await tx.ingredientCasNumber.deleteMany({ where: { ingredientId: id } });
      if (rest.casNumbers.length > 0) {
        await tx.ingredientCasNumber.createMany({
          data: rest.casNumbers.map((value) => ({ ingredientId: id, value })),
        });
      }
    });
  } catch {
    return { formError: "Could not save the changes. Try again." };
  }

  revalidatePath("/ingredients");
  revalidatePath("/library");
  redirect("/ingredients");
}

// No cascading delete: an ingredient still linked to a sample must be unlinked there
// first, otherwise the sample's composition would silently lose an entry.
export async function deleteIngredient(id: string): Promise<void> {
  await requireAdmin();

  const linked = await prisma.sampleIngredient.count({ where: { ingredientId: id } });
  if (linked > 0) return;

  await prisma.ingredientListEntry.delete({ where: { id } });
  revalidatePath("/ingredients");
}
