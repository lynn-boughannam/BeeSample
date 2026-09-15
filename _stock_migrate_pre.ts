import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";

// Step 1 of the SamplePiece migration. Reads the OLD columns (weightG, isUsed,
// Sample.remainingQtyG) with raw SQL, because the generated client already describes the
// new schema and no longer knows they exist. Writes everything to a snapshot file, then
// empties sample_pieces so `prisma db push` can add the new NOT NULL columns.
//
// Run with --apply to actually delete; without it, this only reports.

const apply = process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
  });

  const pieces = await prisma.$queryRawUnsafe<
    Array<{ id: string; sampleId: string; pieceIndex: number; weightG: string; isUsed: boolean }>
  >(`SELECT id, sampleId, pieceIndex, weightG, isUsed FROM sample_pieces ORDER BY sampleId, pieceIndex`);

  const samples = await prisma.$queryRawUnsafe<
    Array<{ id: string; sampleCode: string; totalQtyG: string; remainingQtyG: string }>
  >(`SELECT id, sampleCode, totalQtyG, remainingQtyG FROM samples ORDER BY sampleCode`);

  const withPieces = new Set(pieces.map((p) => p.sampleId));
  const pieceless = samples.filter((s) => !withPieces.has(s.id));

  console.log(`\nexisting piece rows: ${pieces.length}`);
  console.table(
    pieces.map((p) => ({
      sample: samples.find((s) => s.id === p.sampleId)?.sampleCode,
      piece: p.pieceIndex,
      weightG: String(p.weightG),
      isUsed: p.isUsed,
    }))
  );

  console.log(`\nsamples with no pieces (get one backfilled piece each): ${pieceless.length}`);
  console.table(
    pieceless.map((s) => ({
      sample: s.sampleCode,
      storedRemainingG: String(s.remainingQtyG),
      totalG: String(s.totalQtyG),
    }))
  );

  writeFileSync(
    "_stock_migrate_snapshot.json",
    JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        pieces: pieces.map((p) => ({
          sampleId: p.sampleId,
          pieceIndex: p.pieceIndex,
          weightG: String(p.weightG),
        })),
        pieceless: pieceless.map((s) => ({
          sampleId: s.id,
          sampleCode: s.sampleCode,
          remainingQtyG: String(s.remainingQtyG),
        })),
      },
      null,
      2
    )
  );
  console.log("\nsnapshot written to _stock_migrate_snapshot.json");

  if (!apply) {
    console.log("\n(dry run — nothing deleted. Re-run with --apply to empty sample_pieces.)");
    await prisma.$disconnect();
    return;
  }

  // SQL Server won't let db push drop isUsed while its DEFAULT constraint is bound to it,
  // and Prisma doesn't drop that constraint itself.
  const constraints = await prisma.$queryRawUnsafe<Array<{ name: string; column: string }>>(`
    SELECT dc.name AS name, c.name AS [column]
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('sample_pieces')
  `);
  for (const c of constraints.filter((c) => c.column === "isUsed")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE sample_pieces DROP CONSTRAINT [${c.name}]`);
    console.log("dropped default constraint:", c.name);
  }

  const { count } = await prisma.samplePiece.deleteMany();
  console.log(`emptied sample_pieces: ${count} rows removed (restored by _stock_migrate_post.ts)`);

  await prisma.$disconnect();
}
main();
