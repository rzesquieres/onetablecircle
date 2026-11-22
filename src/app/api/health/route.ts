import { connection } from "next/server";

// Health check: open https://<your-domain>/api/health after a deploy.
// "commit" shows which GitHub commit the live site was built from.
export async function GET() {
  await connection(); // always run at request time, never prerendered
  return Response.json({
    status: "ok",
    app: "OneTableCircle",
    commit: process.env.BUILD_COMMIT ?? "unknown",
    builtAt: process.env.BUILT_AT ?? "unknown",
    node: process.version,
    time: new Date().toISOString(),
  }, {
    // Never cache: a CDN copy would show an old commit after a deploy.
    headers: { "Cache-Control": "no-store, max-age=0", "CDN-Cache-Control": "no-store" },
  });
}
