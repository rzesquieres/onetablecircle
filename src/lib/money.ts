/**
 * Money helpers. All amounts are integers in the currency's minor unit
 * (centavos for PHP). Never use floats for money anywhere in the app.
 */

export const DEFAULT_CURRENCY = "PHP";

function assertCentavos(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Amount must be an integer number of centavos, got ${value}`);
  }
}

/** Format centavos for display, e.g. 123450 -> "₱1,234.50". */
export function formatMoney(
  centavos: number,
  currency: string = DEFAULT_CURRENCY,
  locale = "en-PH",
): string {
  assertCentavos(centavos);
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const whole = Math.floor(abs / 100);
  const minor = abs % 100;
  // Format only the integer part with Intl, so no float is ever created.
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).formatToParts(whole);
  const body = parts.map((p) => p.value).join("");
  return `${sign}${body}.${String(minor).padStart(2, "0")}`;
}

/**
 * Parse user-typed money text into centavos without floating-point math.
 * Accepts "1234", "1,234.5", "₱ 1,234.50", "-20". Returns null if invalid
 * or if more than 2 decimal places are given.
 */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[₱,\s]/g, "").replace(/^PHP/i, "");
  const match = /^(-)?(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, neg, whole, frac = ""] = match;
  const centavos = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(centavos)) return null;
  return neg ? -centavos : centavos;
}
