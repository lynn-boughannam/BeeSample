import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";

// One-off. Transactions written before subjectUserId/pieceId existed record the formulator
// only in their note text ("checked out to X", "returned by X"). Without this, a
// formulator's history page would be empty despite real activity.
//
// Deliberately conservative: a row is only updated when the extracted name matches exactly
// one user and the piece index resolves to exactly one piece. Anything ambiguous is left
// alone and reported.
//
// Run with --apply; without it, reports only.

const apply = process.argv.includes("--apply");

const NAME_PATTERNS = [/checked out to (.+)$/i, /returned by (.+?) —/i];
const PIECE_PATTERN = /Piece #(\d+)/i;

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
  });

  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const rows = await prisma.transaction.findMany({
    where: { type: { in: ["CHECKOUT", "RETURN_USAGE"] }, subjectUserId: null },
    select: { id: true, sampleId: true, type: true, note: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`custody transactions missing a subject: ${rows.length}\n`);

  const planned: Array<{ id: string; subjectUserId: string; pieceId: string | null; why: string }> = [];
  const skipped: string[] = [];

  for (const row of rows) {
    const note = row.note ?? "";

    const name = NAME_PATTERNS.map((p) => note.match(p)?.[1]?.trim()).find(Boolean);
    if (!name) {
      skipped.push(`${row.type}: no name in note — ${note}`);
      continue;
    }

    const matches = users.filter((u) => u.name.toLowerCase() === name.toLowerCase());
    if (matches.length !== 1) {
      skipped.push(`${row.type}: "${name}" matched ${matches.length} users — ${note}`);
      continue;
    }

    const index = note.match(PIECE_PATTERN)?.[1];
    let pieceId: string | null = null;
    if (index) {
      const piece = await prisma.samplePiece.findFirst({
        where: { sampleId: row.sampleId, pieceIndex: Number(index) },
        select: { id: true },
      });
      pieceId = piece?.id ?? null;
    }

    planned.push({
      id: row.id,
      subjectUserId: matches[0].id,
      pieceId,
      why: `${row.type} → ${matches[0].name}${pieceId ? ` (piece #${index})` : " (piece unresolved)"}`,
    });
  }

  console.table(planned.map((p) => ({ update: p.why })));
  if (skipped.length) {
    console.log("\nleft alone:");
    for (const s of skipped) console.log("  -", s);
  }

  if (!apply) {
    console.log("\n(dry run — nothing written. Re-run with --apply.)");
    await prisma.$disconnect();
    return;
  }

  for (const p of planned) {
    await prisma.transaction.update({
      where: { id: p.id },
      data: { subjectUserId: p.subjectUserId, ...(p.pieceId ? { pieceId: p.pieceId } : {}) },
    });
  }
  console.log(`\nupdated ${planned.length} transaction(s); ${skipped.length} left alone`);

  await prisma.$disconnect();
}
main();
