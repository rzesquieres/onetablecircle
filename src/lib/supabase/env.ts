// NEXT_PUBLIC_* values are inlined at build time, so they must be set on
// Hostinger before the build that needs them.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

// Show "Continue with Google" only once Google is enabled in Supabase
// (Authentication -> Sign In / Providers -> Google). Set to "on" to show it.
export const googleSignInEnabled = process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === "on";
