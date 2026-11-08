// Plain JavaScript (not .ts) so loading the config needs no TypeScript compiler.
// Hostinger's build server has an old glibc, so Next.js falls back to its
// WebAssembly compiler there; Turbopack needs the native one, so production
// builds use webpack (see "build" in package.json).
import { execSync } from "node:child_process";

/** The git commit being built, so /api/health can show what is live. */
function buildCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  env: {
    BUILD_COMMIT: buildCommit(),
    BUILT_AT: new Date().toISOString(),
  },
};

export default nextConfig;
