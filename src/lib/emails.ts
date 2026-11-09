const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Split pasted text (commas, spaces, semicolons, new lines) into clean, unique, lower-case emails. */
export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const parts = text
    .split(/[\s,;]+/)
    .map((p) => p.trim().toLowerCase().replace(/^<|>$/g, ""))
    .filter(Boolean);
  return {
    valid: [...new Set(parts.filter((p) => EMAIL.test(p)))],
    invalid: parts.filter((p) => !EMAIL.test(p)),
  };
}
