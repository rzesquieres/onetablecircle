/**
 * Links for sharing the OneTableCircle website itself (not a table).
 * Each link is tagged with where it was shared from, so visits from the QR
 * code and from the share button can be told apart in analytics.
 */

export type ShareSource = "qr" | "share";

export const SHARE_TITLE = "OneTableCircle";
export const SHARE_TEXT = "Order together and split the bill to the centavo with OneTableCircle.";

/** The site's address with UTM tags for `source`, e.g. https://onetablecircle.com/?utm_source=qr. */
export function siteShareUrl(origin: string, source: ShareSource): string {
  const url = new URL("/", origin.replace(/\/+$/, "") + "/");
  // Only utm_source: a shorter address keeps the QR code less dense, so it scans from across the table.
  url.searchParams.set("utm_source", source);
  return url.toString();
}

/** The address to show people: no protocol, no tags, e.g. onetablecircle.com. */
export function displaySiteUrl(origin: string): string {
  return origin.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
