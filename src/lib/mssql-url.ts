import type sql from "mssql";

// Parses Prisma's `sqlserver://` connection string format into an `mssql` config
// object, since @prisma/adapter-mssql wants driver config, not Prisma's URL format.
export function parseMssqlUrl(url: string): sql.config {
  const withoutScheme = url.replace(/^sqlserver:\/\//, "");
  const [hostPort, ...paramParts] = withoutScheme.split(";").filter(Boolean);
  const [server, portStr] = hostPort.split(":");

  const params = new Map<string, string>();
  for (const part of paramParts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim().toLowerCase();
    const value = part.slice(eqIndex + 1).trim();
    params.set(key, value);
  }

  return {
    server,
    port: portStr ? Number(portStr) : 1433,
    database: params.get("database"),
    user: params.get("user"),
    password: params.get("password"),
    options: {
      encrypt: params.get("encrypt") !== "false",
      trustServerCertificate: params.get("trustservercertificate") === "true",
    },
  };
}
