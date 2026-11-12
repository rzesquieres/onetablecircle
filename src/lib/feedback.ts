// In-app feedback (OTC-22). The database (submit_feedback) checks everything
// again; these helpers keep the form and the links consistent.

export type FeedbackCategory = "bug" | "idea" | "other";
export type FeedbackStatus = "new" | "read" | "done";
export type FeedbackKind = "form" | "post_meal";

export const FEEDBACK_MAX_CHARS = 2000;

export const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string; placeholder: string }[] = [
  { value: "bug", label: "Something's wrong", placeholder: "What happened, and what did you expect?" },
  { value: "idea", label: "Idea", placeholder: "What would make OneTableCircle better for you?" },
  { value: "other", label: "Other", placeholder: "Tell us anything." },
];

export const FEEDBACK_CATEGORY_TEXT: Record<FeedbackCategory, string> = {
  bug: "Bug",
  idea: "Idea",
  other: "Other",
};

/** Matches the check in submit_feedback(). */
export function looksLikeEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && email.trim().length <= 254;
}

/**
 * The page someone came from, from the ?from= query value. Only same-site
 * paths are kept (no other sites, no protocol-relative "//" links), so the
 * "Back" link can't send people somewhere else.
 */
export function safeFromPath(from: string | null | undefined): string {
  if (!from || !from.startsWith("/") || from.startsWith("//") || from.includes("\\")) return "/";
  if (from.startsWith("/feedback")) return "/";
  return from.slice(0, 200);
}

/** A table id from ?table=, or null if it isn't a uuid. */
export function safeTableId(table: string | null | undefined): string | null {
  return table && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(table) ? table : null;
}

/** Link to the feedback page that remembers where the person was. */
export function feedbackHref(from?: string, tableId?: string): string {
  const params = new URLSearchParams();
  if (from && from !== "/") params.set("from", from);
  if (tableId) params.set("table", tableId);
  const q = params.toString();
  return q ? `/feedback?${q}` : "/feedback";
}

/** Short device description for the admin inbox, from a user-agent string. */
export function describeDevice(userAgent: string): string {
  const ua = userAgent || "";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iPhone/iPad"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /FBAN|FBAV|FB_IAB/.test(ua)
        ? "Facebook app"
        : /CriOS|Chrome\//.test(ua)
          ? "Chrome"
          : /FxiOS|Firefox\//.test(ua)
            ? "Firefox"
            : /Safari\//.test(ua)
              ? "Safari"
              : "";
  return [browser, os].filter(Boolean).join(" on ") || "Unknown device";
}
