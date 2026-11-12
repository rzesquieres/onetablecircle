import { describe, expect, it } from "vitest";
import { isEmailNotConfirmed, isEmailRateLimited } from "./auth-errors";

describe("isEmailNotConfirmed", () => {
  it("matches Supabase's code or message", () => {
    expect(isEmailNotConfirmed({ code: "email_not_confirmed", message: "x" })).toBe(true);
    expect(isEmailNotConfirmed({ message: "Email not confirmed" })).toBe(true);
  });

  it("ignores other errors and non-errors", () => {
    expect(isEmailNotConfirmed({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe(false);
    expect(isEmailNotConfirmed(null)).toBe(false);
    expect(isEmailNotConfirmed("Email not confirmed")).toBe(false);
  });
});

describe("isEmailRateLimited", () => {
  it("matches the email send limits", () => {
    expect(isEmailRateLimited({ code: "over_email_send_rate_limit" })).toBe(true);
    expect(isEmailRateLimited({ message: "email rate limit exceeded" })).toBe(true);
    expect(isEmailRateLimited({ message: "For security purposes, you can only request this after 42 seconds." })).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isEmailRateLimited({ message: "Request rate limit reached" })).toBe(false);
    expect(isEmailRateLimited(undefined)).toBe(false);
  });
});
