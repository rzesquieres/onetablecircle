/**
 * Receipt format Claude returns (structured output) and the pure conversion
 * to receipt rows in integer centavos.
 */
import { z } from "zod";
import { parseMoney } from "../money";
import { priceText } from "./menu-draft";

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

export const AI_RECEIPT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["merchant", "lines", "service_charge", "tax_added", "discount", "tip", "total", "warnings"],
  properties: {
    merchant: nullableString,
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "amount"],
        properties: {
          description: { type: "string" },
          quantity: { type: "integer" },
          amount: { type: "string", description: "Line total as digits, e.g. \"360.00\"" },
        },
      },
    },
    service_charge: { ...nullableString, description: "Service charge amount, digits only" },
    tax_added: { ...nullableString, description: "Only tax ADDED on top of item prices; null if VAT is already included" },
    discount: { ...nullableString, description: "Total discounts (senior/PWD, promos) as a positive number" },
    tip: nullableString,
    total: { ...nullableString, description: "Amount due printed on the receipt" },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

export const AiReceiptSchema = z.object({
  merchant: z.string().nullable(),
  lines: z.array(z.object({ description: z.string(), quantity: z.number().int(), amount: z.string() })),
  service_charge: z.string().nullable(),
  tax_added: z.string().nullable(),
  discount: z.string().nullable(),
  tip: z.string().nullable(),
  total: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type AiReceipt = z.infer<typeof AiReceiptSchema>;

export interface ReceiptRows {
  lines: { description: string; quantity: number; amount_centavos: number }[];
  service_charge_centavos: number;
  tax_centavos: number;
  discount_centavos: number;
  tip_centavos: number;
  printed_total_centavos: number | null;
  warnings: string[];
}

/** Money text -> non-negative centavos (null if unreadable). */
function cents(raw: string | null | undefined): number | null {
  const text = priceText(raw);
  if (!text) return null;
  const v = parseMoney(text);
  return v === null ? null : Math.abs(v);
}

export function toReceiptRows(r: AiReceipt): ReceiptRows {
  const warnings = [...r.warnings];
  const lines: ReceiptRows["lines"] = [];
  for (const l of r.lines) {
    const description = l.description.replace(/\s+/g, " ").trim().slice(0, 120);
    const amount = cents(l.amount);
    if (!description) continue;
    if (amount === null) {
      warnings.push(`Couldn't read the amount for "${description}"`);
      continue;
    }
    lines.push({ description, quantity: Math.min(999, Math.max(1, l.quantity || 1)), amount_centavos: amount });
  }
  return {
    lines,
    service_charge_centavos: cents(r.service_charge) ?? 0,
    tax_centavos: cents(r.tax_added) ?? 0,
    discount_centavos: cents(r.discount) ?? 0,
    tip_centavos: cents(r.tip) ?? 0,
    printed_total_centavos: cents(r.total),
    warnings,
  };
}

/** What the lines and charges add up to (to compare with the printed total). */
export function receiptTotal(r: Pick<ReceiptRows, "service_charge_centavos" | "tax_centavos" | "discount_centavos" | "tip_centavos"> & {
  lines: { amount_centavos: number }[];
}): number {
  return (
    r.lines.reduce((a, l) => a + l.amount_centavos, 0) +
    r.service_charge_centavos +
    r.tax_centavos +
    r.tip_centavos -
    r.discount_centavos
  );
}
