// Refuses to start on a Node this project can't run on, and says which one to use.
//
// This machine has two Node installs: v16.15.1 first on the default PATH, and a v24 under
// AppData that everything here actually needs. Next 16 requires >= 20.9.0 and bails on
// anything older — but the failure arrives as a bare version line, or worse, as child
// processes dying inside the dev server with "Jest worker encountered child process
// exceptions", which says nothing about Node at all.
//
// Loud and early beats baffling and late.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function parse(version) {
  const [major, minor = 0, patch = 0] = version.replace(/^v/, "").split(".").map(Number);
  return { major, minor, patch };
}

function atLeast(actual, required) {
  if (actual.major !== required.major) return actual.major > required.major;
  if (actual.minor !== required.minor) return actual.minor > required.minor;
  return actual.patch >= required.patch;
}

// Read the requirement from Next itself rather than restating it, so this can't drift from
// the version actually installed.
let requirement = ">=20.9.0";
try {
  requirement = require("next/package.json").engines?.node ?? requirement;
} catch {
  // Next not installed yet — fall through with the default and let npm install run.
}

const minimum = parse(requirement.replace(/[^0-9.]/g, ""));
const current = parse(process.versions.node);

if (!atLeast(current, minimum)) {
  const wanted = `${minimum.major}.${minimum.minor}.${minimum.patch}`;
  console.error(
    [
      "",
      `  This project needs Node >= ${wanted}. You are on ${process.version}.`,
      "",
      `  Running: ${process.execPath}`,
      "",
      "  There is a newer Node on this machine that is not first on PATH:",
      "    %LOCALAPPDATA%\\Microsoft\\WinGet\\Packages",
      "      \\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\\node-v24.19.0-win-x64",
      "",
      "  Put it ahead of C:\\Program Files\\nodejs in PATH, or call npm through it directly.",
      "",
    ].join("\n")
  );
  process.exit(1);
}
