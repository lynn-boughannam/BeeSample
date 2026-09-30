// Said after a schema push, because the one thing people forget is the one thing that
// breaks: next dev does not watch node_modules/@prisma/client, so a running server keeps
// the client it started with and 500s on the new columns.
//
// This lives in a file rather than inline in package.json, where the escaping for a
// multi-line string broke under the shell that actually ran it.
console.log(
  [
    "",
    "  Schema pushed and the client regenerated.",
    "",
    "  Restart `next dev` — it does not watch the generated client, so a running",
    "  server will keep 500ing on the new columns until you do.",
    "",
  ].join("\n")
);
