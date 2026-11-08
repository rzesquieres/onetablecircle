import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type Block = Anthropic.Beta.BetaContentBlockParam;
type ImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** True for loopback, private, link-local and other non-public addresses. */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** Only fetch public http(s) pages, never the server's own network. */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a web link.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https links are supported.");
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("That link points to a private address and can't be imported.");
  }
  return url;
}

/** Strip a web page down to readable text (menus are mostly text). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8369;|&#x20b1;/gi, "₱")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Fetch a menu link and turn it into content blocks Claude can read. */
export async function fetchMenuSource(raw: string): Promise<{ blocks: Block[]; warnings: string[] }> {
  let url = await assertPublicUrl(raw);
  // Follow redirects manually so every hop is checked.
  let res: Response | undefined;
  for (let hop = 0; hop < 5; hop++) {
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": "OneTableCircle menu importer", accept: "text/html,application/pdf,image/*;q=0.9,*/*;q=0.5" },
    });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      url = await assertPublicUrl(new URL(next, url).toString());
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error(`Couldn't open that link (error ${res?.status ?? "?"}).`);

  const declared = Number(res.headers.get("content-length") || "0");
  if (declared > MAX_BYTES) throw new Error("That file is too big (over 15 MB).");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("That file is too big (over 15 MB).");
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();

  if (type === "application/pdf" || url.pathname.toLowerCase().endsWith(".pdf")) {
    return {
      blocks: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }],
      warnings: [],
    };
  }
  if (IMAGE_TYPES.has(type)) {
    return {
      blocks: [{ type: "image", source: { type: "base64", media_type: type as ImageType, data: buf.toString("base64") } }],
      warnings: [],
    };
  }

  const text = htmlToText(buf.toString("utf8"));
  if (text.length < 80) {
    throw new Error(
      "That page has almost no text (it may load its menu with JavaScript or show it as images). Try a screenshot or PDF instead.",
    );
  }
  const warnings: string[] = [];
  let body = text;
  if (text.length > MAX_TEXT_CHARS) {
    body = text.slice(0, MAX_TEXT_CHARS);
    warnings.push("The page was very long, so only the first part was read. Check that nothing is missing.");
  }
  return { blocks: [{ type: "text", text: `Menu page ${url.toString()}:\n\n${body}` }], warnings };
}

/** Uploaded files (already shrunk in the browser) -> content blocks. */
export function fileBlocks(files: { type: string; data: Buffer }[]): Block[] {
  return files.map((f) =>
    f.type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data.toString("base64") } }
      : { type: "image", source: { type: "base64", media_type: f.type as ImageType, data: f.data.toString("base64") } },
  );
}
