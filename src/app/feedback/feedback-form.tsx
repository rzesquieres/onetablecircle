"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Card, Chip, Input, Label, Notice, Spinner } from "@/components/ui";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MAX_CHARS,
  looksLikeEmail,
  safeFromPath,
  safeTableId,
  type FeedbackCategory,
} from "@/lib/feedback";
import { friendlyError, getSupabase } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";
import { useUser } from "@/lib/use-user";

const CONTACT = "admin@onetablecircle.com";

/**
 * Feedback form (OTC-22). Works for account holders, guests who joined a table
 * through a link, and visitors who haven't joined anything. A visitor is signed
 * in as a guest only when they press Send, so just opening the page creates
 * nothing.
 */
export function FeedbackForm() {
  const params = useSearchParams();
  const from = safeFromPath(params.get("from"));
  const tableId = safeTableId(params.get("table"));
  const { user, isGuest, loading } = useUser();

  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [message, setMessage] = useState("");
  const [contactOk, setContactOk] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  // Account holders are replied to at their account email; guests and visitors type one.
  const needsEmail = !user || isGuest;
  const placeholder = FEEDBACK_CATEGORIES.find((c) => c.value === category)?.placeholder ?? "Pick a type above first.";
  const backLabel = from === "/" ? "← Home" : "← Back";

  async function send(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!category) return setError("Please choose what kind of feedback this is.");
    if (!message.trim()) return setError("Please type your feedback.");
    if (contactOk && needsEmail && !looksLikeEmail(email)) {
      return setError("Please enter a valid email address so we can reply.");
    }
    setBusy(true);
    try {
      const supabase = getSupabase();
      if (!user) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
      }
      const { error } = await supabase.rpc("submit_feedback", {
        p_category: category,
        p_message: message.trim(),
        p_page_path: from,
        p_session_id: tableId,
        p_contact_email: contactOk && needsEmail ? email.trim() : null,
        p_contact_ok: contactOk,
        p_user_agent: navigator.userAgent.slice(0, 300),
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <div>
      <Link href={from} className="text-sm text-ink-soft">{backLabel}</Link>
      <h1 className="text-2xl font-semibold">Send feedback</h1>
      <p className="text-sm text-ink-soft">
        OneTableCircle is in open beta. Tell us what works, what doesn&apos;t, and what you&apos;d like next. We read
        everything.
      </p>
    </div>
  );

  if (!supabaseConfigured) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Notice>
          Email us at <a href={`mailto:${CONTACT}`} className="text-brand underline">{CONTACT}</a>.
        </Notice>
      </div>
    );
  }
  if (loading) return <Spinner />;

  if (sent) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Card className="flex flex-col gap-3">
          <p className="text-lg font-semibold">Thank you!</p>
          <p className="text-ink-soft">
            We got your feedback.{contactOk ? " If we have questions, we'll email you." : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={from}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white active:bg-brand-strong"
            >
              {from === "/" ? "Back to home" : "Go back"}
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                setSent(false);
                setMessage("");
                setCategory(null);
              }}
            >
              Send more
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <Card>
        <form onSubmit={send} className="flex flex-col gap-4">
          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-ink-soft">What is it about?</legend>
            <div className="flex flex-wrap gap-2">
              {FEEDBACK_CATEGORIES.map((c) => (
                <Chip key={c.value} selected={category === c.value} onClick={() => setCategory(c.value)}>
                  {c.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <div>
            <Label htmlFor="fb-message">Your feedback</Label>
            <textarea
              id="fb-message"
              rows={6}
              maxLength={FEEDBACK_MAX_CHARS}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              placeholder={placeholder}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="mt-1 text-right text-xs text-ink-soft tabular-nums">
              {message.length.toLocaleString("en-PH")} / {FEEDBACK_MAX_CHARS.toLocaleString("en-PH")}
            </p>
          </div>

          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-brand"
              checked={contactOk}
              onChange={(e) => setContactOk(e.target.checked)}
            />
            It&apos;s OK to email me about this
          </label>
          {contactOk && needsEmail && (
            <div>
              <Label htmlFor="fb-email">Your email</Label>
              <Input
                id="fb-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={254}
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="mt-1 text-xs text-ink-soft">Only used to reply to this feedback.</p>
            </div>
          )}

          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send feedback"}</Button>
          <p className="text-xs text-ink-soft">
            We also save the page you came from and your browser type, to help us fix problems.
            {tableId ? " Because you came from a table, we save which table too." : ""} See our{" "}
            <Link href="/privacy" className="underline">Privacy Policy</Link>.
          </p>
        </form>
      </Card>
    </div>
  );
}
