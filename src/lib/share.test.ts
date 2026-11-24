import { describe, expect, it } from "vitest";
import { displaySiteUrl, siteShareUrl } from "./share";

describe("siteShareUrl", () => {
  it("tags the home page with the source", () => {
    expect(siteShareUrl("https://onetablecircle.com", "qr")).toBe(
      "https://onetablecircle.com/?utm_source=qr",
    );
    expect(siteShareUrl("https://onetablecircle.com", "share")).toContain("utm_source=share");
  });

  it("ignores trailing slashes on the origin", () => {
    expect(siteShareUrl("https://onetablecircle.com//", "qr")).toBe(siteShareUrl("https://onetablecircle.com", "qr"));
  });

  it("works for local copies", () => {
    expect(siteShareUrl("http://localhost:3000", "share").startsWith("http://localhost:3000/?")).toBe(true);
  });
});

describe("displaySiteUrl", () => {
  it("drops the protocol and trailing slash", () => {
    expect(displaySiteUrl("https://onetablecircle.com/")).toBe("onetablecircle.com");
    expect(displaySiteUrl("http://localhost:3000")).toBe("localhost:3000");
  });
});
