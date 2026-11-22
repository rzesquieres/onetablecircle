import { describe, expect, it } from "vitest";
import { adjustmentRows } from "./bill-data";

const name = (pid: string) => ({ ana: "Ana", ben: "Ben", carl: "Carl" })[pid] ?? "Someone";

describe("adjustmentRows (OTC-33)", () => {
  it("labels treats both ways", () => {
    expect(adjustmentRows([{ participantId: "ana", amount: 30000, kind: "treat", direction: "out" }], name)).toEqual([
      { label: "Covered by Ana", value: -30000 },
    ]);
    expect(adjustmentRows([{ participantId: "ben", amount: 30000, kind: "treat", direction: "in" }], name)).toEqual([
      { label: "For Ben (libre)", value: 30000 },
    ]);
  });

  it("shows a celebrant's moves as one line, and others' part of it", () => {
    expect(
      adjustmentRows(
        [
          { participantId: "ana", amount: 13334, kind: "celebrant", direction: "out" },
          { participantId: "ben", amount: 13333, kind: "celebrant", direction: "out" },
        ],
        name,
      ),
    ).toEqual([{ label: "🎂 Covered by everyone", value: -26667 }]);
    expect(adjustmentRows([{ participantId: "carl", amount: 13333, kind: "celebrant", direction: "in" }], name)).toEqual([
      { label: "🎂 Carl's share", value: 13333 },
    ]);
    expect(adjustmentRows(undefined, name)).toEqual([]);
  });
});
