import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { stockFromPieces, stockLevel } from "./src/lib/stock";

// Confirms the real, post-migration numbers the Library table and sample pages will show,
// via the same helper the pages call. Read-only.
async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
  });

  const samples = await prisma.sample.findMany({
    select: {
      sampleCode: true,
      isDiscarded: true,
      totalQtyG: true,
      pieces: { select: { remainingWeightG: true, status: true } },
    },
    orderBy: { sampleCode: "asc" },
  });

  console.table(
    samples.map((s) => {
      const stock = stockFromPieces(s.pieces);
      return {
        sample: s.sampleCode,
        "total (g)": s.totalQtyG.toString(),
        "remaining (g)": stock.remainingQtyG,
        "remaining (pcs)": stock.remainingQtyPcs,
        flag: s.isDiscarded ? "DISCARDED" : stockLevel(stock, s.totalQtyG),
      };
    })
  );

  await prisma.$disconnect();
}
main();
