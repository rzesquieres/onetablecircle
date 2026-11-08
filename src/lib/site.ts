/**
 * Public origin of the site, e.g. "https://onetablecircle.com".
 * Behind Hostinger's proxy the request URL can be an internal address, so
 * prefer NEXT_PUBLIC_SITE_URL, then the forwarded headers.
 */
export function publicOrigin(request: { headers: Headers; nextUrl: { origin: string } }): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  if (host) return `${proto}://${host.split(",")[0].trim()}`;
  return request.nextUrl.origin;
}

/** Only allow redirects to paths on this site (prevents open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
