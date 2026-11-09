import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MENU_JSON_SCHEMA, AiMenuSchema, type AiMenu } from "./menu-draft";
import { AI_RECEIPT_JSON_SCHEMA, AiReceiptSchema, type AiReceipt } from "./receipt-draft";

/** Default per the Claude API guide; override with ANTHROPIC_MODEL on Hostinger if you want a cheaper model. */
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
/** On a safety decline, the API re-runs the request on a fallback model it picks (server-side). */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_CONTINUATIONS = 5;

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}

type Params = Omit<Anthropic.Beta.MessageCreateParamsStreaming, "stream" | "betas" | "model">;

/**
 * One request, streamed (long menus can produce long outputs), with refusal
 * fallback. Server-tool turns that pause (`pause_turn`) are resumed up to
 * MAX_CONTINUATIONS times by sending the paused assistant turn back.
 */
async function run(params: Params): Promise<Anthropic.Beta.BetaMessage> {
  const messages = [...params.messages];
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const message = await getClient()
      .beta.messages.stream({ ...params, messages, model: MODEL, betas: [FALLBACK_BETA], fallbacks: "default" })
      .finalMessage();
    if (message.stop_reason !== "pause_turn") return message;
    messages.push({ role: "assistant", content: message.content });
  }
  throw new Error("The AI took too many steps. Please try again.");
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function checkStop(message: Anthropic.Beta.BetaMessage) {
  if (message.stop_reason === "refusal") {
    throw new Error("The AI declined to read this menu. Try a different photo or link.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("This menu is too long to read in one go. Try importing it in parts (a few pages at a time).");
  }
}

const EXTRACT_SYSTEM = `You turn restaurant and café menus into structured data for a group-ordering app in the Philippines.

Rules:
- Copy only what the menu actually shows. Never invent items, prices or options. If something is unclear or cut off, leave it out and add a short note to "warnings".
- Prices are in Philippine pesos unless the menu clearly says otherwise. Write prices as digits only, like "180" or "180.50" (no currency symbol, no commas). Use null when an item has no visible price.
- Keep the menu's own categories and item names (fix obvious OCR typos only).
- When items come in sizes or with add-ons (e.g. Tall / Grande / Venti, milk choices, extra shot, sugar level), describe them once in "option_groups" and list the group names on each item they apply to. The item's "price" is its smallest/base price, and each option's "price_change" is the difference from that base ("0" for the base size).
- Use "single" for choose-one groups (sizes, sugar level) and "multi" for add-ons. Mark a group required only if the customer must pick one (like size).
- If an item has several sizes but they differ per item in a way one group can't express, list the sizes as separate items instead (e.g. "Pizza (10 in)", "Pizza (14 in)").`;

/** Read a menu from images / a PDF / page text and return it in the app's menu format. */
export async function extractMenu(content: Anthropic.Beta.BetaContentBlockParam[], hint: string): Promise<AiMenu> {
  const message = await run({
    max_tokens: 64000,
    system: EXTRACT_SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: AI_MENU_JSON_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          ...content,
          { type: "text", text: `Extract the full menu.${hint ? `\n\nContext: ${hint}` : ""}` },
        ],
      },
    ],
  });
  checkStop(message);
  let json: unknown;
  try {
    json = JSON.parse(textOf(message));
  } catch {
    throw new Error("The AI's answer couldn't be read. Please try again.");
  }
  const parsed = AiMenuSchema.safeParse(json);
  if (!parsed.success) throw new Error("The AI's answer was incomplete. Please try again.");
  return parsed.data;
}

/**
 * "AI add store": search the web for a store's current menu and write it out
 * as plain text (with sources), to be turned into structured data by extractMenu().
 */
export async function researchStoreMenu(name: string, branch: string): Promise<{ text: string; sources: string[] }> {
  const where = branch ? `${name} (${branch}), Philippines` : `${name}, Philippines`;
  const message = await run({
    max_tokens: 64000,
    output_config: { effort: "medium" },
    tools: [
      {
        type: "web_search_20260209",
        name: "web_search",
        max_uses: 8,
        user_location: { type: "approximate", country: "PH", timezone: "Asia/Manila" },
      },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 },
    ],
    messages: [
      {
        role: "user",
        content: `Find the current menu, with prices in Philippine pesos, for: ${where}.

Prefer the official website, official social media, or a recent delivery-app listing (GrabFood, foodpanda). Fetch the best page(s) and read them.

Then write out the complete menu as plain text: each category, every item with its price, and sizes / add-ons with their prices. Copy what the sources say; don't guess prices. If sources disagree, use the most recent one and say so.

Start your answer with one line per source you used, like:
SOURCE: https://...
If you can't find a menu with prices, say so plainly and explain what you found.`,
      },
    ],
  });
  checkStop(message);
  const text = textOf(message).trim();
  if (!text) throw new Error("The AI couldn't find a menu for this store. Try importing from a link or photos instead.");
  const sources = [...text.matchAll(/^SOURCE:\s*(https?:\/\/\S+)/gim)].map((m) => m[1]);
  return { text, sources };
}

const RECEIPT_SYSTEM = `You read restaurant and café receipts from the Philippines for a bill-splitting app.

Rules:
- "lines": one entry per purchased item line, in printed order. "amount" is the line TOTAL (quantity × unit price) as digits only, e.g. "360.00". Include modifiers/add-ons that have their own price as separate lines. Skip lines with no price that only describe the item above.
- Do NOT put these in "lines": subtotal, service charge, VAT/tax lines, discounts, totals, "amount due", cash tendered, change, card/GCash payment, VATable sales, VAT-exempt sales, zero-rated sales.
- Philippine menu prices usually already include 12% VAT; the "VAT" or "VATable sales" lines are then only informational. Put tax in "tax_added" ONLY if it is added on top to reach the total. Otherwise null.
- "service_charge": the service charge amount (often 10%). "discount": the total of all discounts (senior citizen, PWD, promos) as a positive number. "tip": only if a tip/gratuity is printed.
- "total": the final amount due as printed.
- Copy numbers exactly; never guess. If something is blurry or cut off, leave it out and say so in "warnings". Mention in "warnings" if the lines plus charges don't add up to the printed total.`;

/** Read a receipt photo (one or more images) into lines and charges. */
export async function extractReceipt(content: Anthropic.Beta.BetaContentBlockParam[]): Promise<AiReceipt> {
  const message = await run({
    max_tokens: 32000,
    system: RECEIPT_SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: AI_RECEIPT_JSON_SCHEMA } },
    messages: [{ role: "user", content: [...content, { type: "text", text: "Read this receipt." }] }],
  });
  if (message.stop_reason === "refusal") throw new Error("The AI declined to read this receipt. Try another photo.");
  if (message.stop_reason === "max_tokens") throw new Error("This receipt is too long to read. Try typing it in instead.");
  let json: unknown;
  try {
    json = JSON.parse(textOf(message));
  } catch {
    throw new Error("The AI's answer couldn't be read. Please try again.");
  }
  const parsed = AiReceiptSchema.safeParse(json);
  if (!parsed.success) throw new Error("The AI's answer was incomplete. Please try again.");
  return parsed.data;
}