import { connection } from "next/server";

// Simple health check: open https://<your-domain>/api/health after a deploy.
export async function GET() {
  await connection(); // always run at request time, never prerendered
  return Response.json({
    status: "ok",
    app: "OneTableCircle",
    node: process.version,
    time: new Date().toISOString(),
  });
}
