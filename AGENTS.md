<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working in this repo

Notes that only become obvious after losing an hour to them.

## Restart `next dev` after any schema change

`next dev` does not watch `node_modules/@prisma/client`, so a running server keeps the
client it started with. After `prisma db push` / `prisma generate`, the build is clean and
the tests pass while the dev server still 500s on the new columns:

- `The column X does not exist in the current database` (P2022)
- `Unknown field X for include statement on model Y`

Both mean the server is stale, not that the code is wrong. Stop it, delete `.next/dev`,
start it again. If a page errors on a field you just added, check this before debugging
anything else.

## SQL Server treats NULLs as equal in a UNIQUE constraint

A nullable `@unique` column allows exactly **one** NULL row across the whole table, so the
second request-less transaction — or the second order that hasn't produced a sample yet —
fails with P2002. This has bitten twice: `Transaction.requestId` and
`SampleOrder.producedSampleId`. Both are now plain nullable columns with the invariant
enforced in application code.

Prisma's schema language can't declare the filtered index (`WHERE col IS NOT NULL`) that
would express this properly, so do not add `@unique` to a nullable foreign key here.

## `db push` can't add a required column to a non-empty table

It also can't drop a column whose DEFAULT constraint still exists. Where that comes up,
snapshot the rows, empty the table, push, then restore — see `_stock_migrate_pre.ts` and
`_stock_migrate_post.ts` for the pattern used when `SamplePiece` was reshaped.

## Verification scripts

`_verify_*.ts` at the repo root are the regression suite. Each seeds its own data against
the real database, asserts, and cleans up after itself in a `finally`. Run one with
`npx tsx ./_verify_stock.ts`.

Anything importing a module marked `server-only` (`src/lib/reports.ts`,
`src/lib/stock-queries.ts`, `src/lib/dashboard.ts`) needs
`npx tsx --conditions=react-server ./_verify_reports.ts`, or the marker throws.
