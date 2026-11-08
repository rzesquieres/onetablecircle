// Plain JavaScript (not .ts) so loading the config needs no TypeScript compiler.
// Hostinger's build server has an old glibc, so Next.js falls back to its
// WebAssembly compiler there; Turbopack needs the native one, so production
// builds use webpack (see "build" in package.json).

/** @type {import('next').NextConfig} */
const nextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
