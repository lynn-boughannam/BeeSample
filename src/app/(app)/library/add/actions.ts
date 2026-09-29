"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { prepareSampleCreate } from "@/lib/sample-creation";

export type CreateSampleState =
  | { fieldErrors?: Record<string, string>; formError?: string }
  | undefined;

// Direct entry: an Admin types a sample straight into the library. Reception creates one
// the same way from an order — see prepareSampleCreate, which both go through so the two
// cannot produce different samples.
export async function createSample(
  _prev: CreateSampleState,
  formData: FormData
): Promise<CreateSampleState> {
  const session = await requireAdmin();

  const prepared = await prepareSampleCreate(formData, session.user.id);
  if (!prepared.ok) {
    return { fieldErrors: prepared.fieldErrors, formError: prepared.formError };
  }

  try {
    // Nested creates run in one transaction, so the sample, its ingredients, its initial
    // location entry and every piece row commit together or not at all.
    await prisma.sample.create({ data: prepared.data });
  } catch {
    return { formError: "Could not save the sample. Try again." };
  }

  revalidatePath("/library");
  redirect("/library");
}
