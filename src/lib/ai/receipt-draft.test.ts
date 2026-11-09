import { describe, expect, it } from "vitest";
import { receiptTotal, toReceiptRows } from "./receipt-draft";

describe("toReceiptRows", () => {
  it("converts a typical Philippine receipt to centavos", () => {
    const rows = toReceiptRows({
      merchant: "Kape Ni Juan",
      lines: [
        { description: "2  ICED LATTE", quantity: 2, amount: "360.00" },
        { description: "NACHOS PLTR", quantity: 1, amount: "₱1,250.50" },
        { description: "", quantity: 1, amount: "10" },
        { description: "MYSTERY", quantity: 0, amount: "n/a" },
      ],
      service_charge: "161.05",
      tax_added: null,
      discount: "-50",
      tip: null,
      total: "1,721.55",
      warnings: [],
    });
    expect(rows.lines).toEqual([
      { description: "2 ICED LATTE", quantity: 2, amount_centavos: 36000 },
      { description: "NACHOS PLTR", quantity: 1, amount_centavos: 125050 },
    ]);
    expect(rows.warnings).toEqual(['Couldn\'t read the amount for "MYSTERY"']);
    expect(rows).toMatchObject({
      service_charge_centavos: 16105,
      tax_centavos: 0,
      discount_centavos: 5000,
      tip_centavos: 0,
      printed_total_centavos: 172155,
    });
    expect(receiptTotal(rows)).toBe(36000 + 125050 + 16105 - 5000);
  });
});
