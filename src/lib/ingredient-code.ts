import { prisma } from "@/lib/prisma";

// Format: INCI + zero-padded sequence, e.g. INCI0001. Not year-scoped, unlike sample
// codes. Padding is 4 digits minimum and grows naturally past 9999 rather than truncating.
//
// Same concurrency approach as nextSampleCode(): the increment is a single row-locked
// UPDATE, wrapped in a Serializable transaction so two callers can't both create the
// counter row on a first-ever run.
export async function nextIngredientCode(): Promise<string> {
  const seq = await prisma.$transaction(
    async (tx) => {
      try {
        return await tx.ingredientCodeSequence.update({
          where: { id: "INCI" },
          data: { lastValue: { increment: 1 } },
        });
      } catch {
        return tx.ingredientCodeSequence.create({ data: { id: "INCI", lastValue: 1 } });
      }
    },
    { isolationLevel: "Serializable" }
  );

  return `INCI${String(seq.lastValue).padStart(4, "0")}`;
}
