import { prisma } from "@/lib/prisma";

// Format: S-<2-digit year><zero-padded sequence>, e.g. S-2409 for the 9th sample of 20xx.
// Sequence pads to 2 digits minimum and grows naturally past 99 without truncating.
//
// Concurrency: the increment-on-existing-row path is a single `UPDATE ... SET lastValue =
// lastValue + 1`, which SQL Server row-locks for its duration — safe under concurrent
// callers on its own. The one gap a plain upsert() leaves is the very first sample of a
// brand-new year: two concurrent requests could both see no row and race to create one.
// Wrapping in a Serializable transaction, plus falling back from update to create (rather
// than the other way round), closes that gap — SQL Server serializes the transactions
// instead of allowing both creates to proceed.
export async function nextSampleCode(now: Date = new Date()): Promise<string> {
  const year = now.getFullYear();
  const yy = String(year).slice(-2);

  const seq = await prisma.$transaction(
    async (tx) => {
      try {
        return await tx.sampleCodeSequence.update({
          where: { year },
          data: { lastValue: { increment: 1 } },
        });
      } catch {
        return tx.sampleCodeSequence.create({ data: { year, lastValue: 1 } });
      }
    },
    { isolationLevel: "Serializable" }
  );

  const padded = String(seq.lastValue).padStart(2, "0");
  return `S-${yy}${padded}`;
}
