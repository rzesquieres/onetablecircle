/**
 * Which Claude model each AI feature uses. Kept apart from claude.ts (server-only)
 * so it can be unit-tested. Change models with env vars on Hostinger, no code edit.
 */
type Env = Record<string, string | undefined>;

export const DEFAULT_MENU_MODEL = "claude-opus-5-5";
/** Receipts are short and well-structured, so a cheaper model is enough (OTC-26). */
export const DEFAULT_RECEIPT_MODEL = "claude-sonnet-5-5";

function pick(value: string | undefined, fallback: string): string {
  const v = value?.trim();
  return v ? v : fallback;
}

/** Menu import and "AI add store": ANTHROPIC_MODEL, else Opus. */
export function menuModel(env: Env = process.env): string {
  return pick(env.ANTHROPIC_MODEL, DEFAULT_MENU_MODEL);
}

/** Receipt scanning: ANTHROPIC_RECEIPT_MODEL, else Sonnet. Not affected by ANTHROPIC_MODEL. */
export function receiptModel(env: Env = process.env): string {
  return pick(env.ANTHROPIC_RECEIPT_MODEL, DEFAULT_RECEIPT_MODEL);
}
