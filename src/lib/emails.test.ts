import { describe, expect, it } from "vitest";
import { parseEmails } from "./emails";

describe("parseEmails", () => {
  it("handles commas, new lines, case, duplicates and <brackets>", () => {
    expect(parseEmails("Ana@Gmail.com, ben@yahoo.com\n<carla@company.ph>; ana@gmail.com")).toEqual({
      valid: ["ana@gmail.com", "ben@yahoo.com", "carla@company.ph"],
      invalid: [],
    });
  });

  it("reports things that aren't emails", () => {
    expect(parseEmails("ana@gmail.com nope @x.com")).toEqual({ valid: ["ana@gmail.com"], invalid: ["nope", "@x.com"] });
    expect(parseEmails("   ")).toEqual({ valid: [], invalid: [] });
  });
});
