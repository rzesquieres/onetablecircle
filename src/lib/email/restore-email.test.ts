import { describe, expect, it } from "vitest";
import { restoreEmail } from "./restore-email";

describe("restoreEmail", () => {
  it("links to sign in when their sign-in still works", () => {
    const e = restoreEmail({ origin: "https://onetablecircle.com", name: "Dina", needsPasswordReset: false });
    expect(e.subject).toMatch(/restored/);
    expect(e.text).toContain("Hi Dina,");
    expect(e.text).toContain("https://onetablecircle.com/login");
    expect(e.text).not.toContain("mode=forgot");
    expect(e.html).toContain('href="https://onetablecircle.com/login"');
  });

  it("links to Forgot password when they need a new password", () => {
    const e = restoreEmail({ origin: "https://onetablecircle.com", name: "", needsPasswordReset: true });
    expect(e.text.startsWith("Hi,")).toBe(true);
    expect(e.text).toContain("https://onetablecircle.com/login?mode=forgot");
    expect(e.html).toContain("Set a new password");
  });

  it("escapes the name in the HTML", () => {
    const e = restoreEmail({ origin: "https://x.test", name: '<b>"Bob"</b>', needsPasswordReset: false });
    expect(e.html).toContain("&lt;b&gt;&quot;Bob&quot;&lt;/b&gt;");
    expect(e.html).not.toContain("<b>");
  });
});
