import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Server action bodies are capped at 1 MB by default, which silently undercuts the
    // 10 MB-per-file limit the supplier document upload advertises: a 2 MB COA would be
    // rejected by the framework before the action's own validation ever ran, with an
    // error that says nothing useful. Raised to cover a realistic batch — the action
    // enforces the per-file and per-batch limits itself, so this is only the outer bound.
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
