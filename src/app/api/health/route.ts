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
  });
}
