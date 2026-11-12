import { describe, expect, it } from "vitest";
import { describeDevice, feedbackHref, looksLikeEmail, safeFromPath, safeTableId } from "./feedback";

const TABLE = "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c";

describe("feedback helpers", () => {
  it("builds links that remember where you were", () => {
    expect(feedbackHref()).toBe("/feedback");
    expect(feedbackHref("/")).toBe("/feedback");
    expect(feedbackHref("/profile")).toBe("/feedback?from=%2Fprofile");
    expect(feedbackHref(`/s/${TABLE}`, TABLE)).toBe(`/feedback?from=%2Fs%2F${TABLE}&table=${TABLE}`);
  });

  it("only keeps same-site paths to go back to", () => {
    expect(safeFromPath("/profile")).toBe("/profile");
    expect(safeFromPath(null)).toBe("/");
    expect(safeFromPath("https://evil.example")).toBe("/");
    expect(safeFromPath("//evil.example")).toBe("/");
    expect(safeFromPath("/\\evil.example")).toBe("/");
    expect(safeFromPath("/feedback")).toBe("/");
    expect(safeFromPath("/" + "a".repeat(300))).toHaveLength(200);
  });

  it("only accepts a uuid as a table id", () => {
    expect(safeTableId(TABLE)).toBe(TABLE);
    expect(safeTableId("abc")).toBeNull();
    expect(safeTableId(undefined)).toBeNull();
  });

  it("checks emails the same way as the database", () => {
    expect(looksLikeEmail("ana@gmail.com")).toBe(true);
    expect(looksLikeEmail(" ana@gmail.com ")).toBe(true);
    expect(looksLikeEmail("ana@gmail")).toBe(false);
    expect(looksLikeEmail("ana gmail.com")).toBe(false);
  });

  it("describes the device briefly", () => {
    expect(
      describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"),
    ).toBe("Safari on iPhone/iPad");
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36")).toBe(
      "Chrome on Android",
    );
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14) [FBAN/FB4A;FBAV/440.0]")).toBe("Facebook app on Android");
    expect(describeDevice("")).toBe("Unknown device");
  });
});
