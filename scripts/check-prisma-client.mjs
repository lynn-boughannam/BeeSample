// The generated Prisma client is not watched by `next dev`, so a schema change made while
// the server is running leaves it serving an old client: every new column comes back as
// "Unknown argument", which reads like a code bug and isn't one. That has cost real time
// twice, so `npm run dev` now refuses to start against a client older than the schema.
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// This file lives in scripts/, so the project root is one level up.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = join(root, "prisma", "schema.prisma");
const client = join(root, "node_modules", ".prisma", "client", "index.d.ts");

function mtimeOf(path, what) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    // Deliberately not silent: a check that can't find what it is checking is a broken
    // check, and a broken check that passes is worse than no check at all.
    console.error(`\n  Could not read ${what} at ${path}`);
    console.error("  Run:  npm install && npx prisma generate\n");
    process.exit(1);
  }
}

if (mtimeOf(schema, "the Prisma schema") > mtimeOf(client, "the generated Prisma client")) {
  console.error("\n  The Prisma client is older than prisma/schema.prisma.");
  console.error("  Starting like this serves stale columns and fails at runtime.\n");
  console.error("  Run:  npx prisma generate\n");
  process.exit(1);
}
