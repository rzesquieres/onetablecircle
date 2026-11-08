import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney } from "./money";

describe("formatMoney", () => {
  it("formats centavos as pesos", () => {
    expect(formatMoney(123450)).toBe("₱1,234.50");
    expect(formatMoney(5)).toBe("₱0.05");
    expect(formatMoney(0)).toBe("₱0.00");
  });

  it("formats negative amounts (discounts)", () => {
    expect(formatMoney(-2000)).toBe("-₱20.00");
  });

  it("rejects non-integer amounts", () => {
    expect(() => formatMoney(12.5)).toThrow(TypeError);
  });
});

describe("parseMoney", () => {
  it("parses common inputs into centavos", () => {
    expect(parseMoney("1234")).toBe(123400);
    expect(parseMoney("1,234.5")).toBe(123450);
    expect(parseMoney("₱ 1,234.50")).toBe(123450);
    expect(parseMoney("0.1")).toBe(10);
    expect(parseMoney("-20")).toBe(-2000);
  });

  it("avoids float rounding errors", () => {
    // 0.1 + 0.2 style problems must never happen
    expect(parseMoney("0.29")).toBe(29);
    expect(parseMoney("1.15")).toBe(115);
  });

  it("returns null for invalid input", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("1.234")).toBeNull();
    expect(parseMoney("1.2.3")).toBeNull();
  });
});
