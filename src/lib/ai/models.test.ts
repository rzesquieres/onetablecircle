import { describe, expect, it } from "vitest";
import { DEFAULT_MENU_MODEL, DEFAULT_RECEIPT_MODEL, menuModel, receiptModel } from "./models";

describe("AI model settings", () => {
  it("defaults receipts to Sonnet and menus to Opus", () => {
    expect(receiptModel({})).toBe("claude-sonnet-5-5");
    expect(DEFAULT_RECEIPT_MODEL).toBe("claude-sonnet-5-5");
    expect(menuModel({})).toBe(DEFAULT_MENU_MODEL);
  });

  it("uses ANTHROPIC_RECEIPT_MODEL for receipts when set", () => {
    expect(receiptModel({ ANTHROPIC_RECEIPT_MODEL: "claude-haiku-5-5" })).toBe("claude-haiku-5-5");
    expect(receiptModel({ ANTHROPIC_RECEIPT_MODEL: "  claude-haiku-5-5 " })).toBe("claude-haiku-5-5");
  });

  it("falls back when the setting is empty or blank", () => {
    expect(receiptModel({ ANTHROPIC_RECEIPT_MODEL: "" })).toBe(DEFAULT_RECEIPT_MODEL);
    expect(receiptModel({ ANTHROPIC_RECEIPT_MODEL: "   " })).toBe(DEFAULT_RECEIPT_MODEL);
    expect(menuModel({ ANTHROPIC_MODEL: " " })).toBe(DEFAULT_MENU_MODEL);
  });

  it("keeps the two settings independent", () => {
    const env = { ANTHROPIC_MODEL: "claude-opus-5-5" };
    expect(receiptModel(env)).toBe(DEFAULT_RECEIPT_MODEL);
    expect(menuModel({ ANTHROPIC_RECEIPT_MODEL: "claude-haiku-5-5" })).toBe(DEFAULT_MENU_MODEL);
  });
});
