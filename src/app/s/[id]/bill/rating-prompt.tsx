"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Notice } from "@/components/ui";
import { feedbackHref } from "@/lib/feedback";
import { friendlyError, getSupabase } from "@/lib/supabase/client";

const LABELS = ["", "Didn't work", "Had problems", "OK", "Good", "Great"];

/**
 * "How did OneTableCircle work for your table?" (OTC-23). Shown on the bill
 * once it's sent, once per person per table. Small card under the amounts, so
 * it never hides what anyone owes.
 */
export function RatingPrompt({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<"checking" | "ask" | "thanks" | "hidden">("checking");
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSupabase()
      .rpc("post_meal_rating_due", { p_session_id: sessionId })
      .then(({ data, error }) => {
        // If anything goes wrong (e.g. the migration isn't in yet), just don't ask.
        if (!cancelled) setState(!error && data === true ? "ask" : "hidden");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function send() {
    setBusy(true);
    setError("");
    const { error } = await getSupabase().rpc("submit_post_meal_rating", {
      p_session_id: sessionId,
      p_rating: rating,
      p_message: message.trim(),
      p_user_agent: navigator.userAgent.slice(0, 300),
    });
    setBusy(false);
    if (error) setError(friendlyError(error));
    else setState("thanks");
  }

  async function notNow() {
    setState("hidden");
    await getSupabase().rpc("dismiss_post_meal_rating", { p_session_id: sessionId });
  }

  if (state === "checking" || state === "hidden") return null;

  if (state === "thanks") {
    return (
      <Card className="flex flex-col gap-1 text-center">
        <p className="font-semibold">Thanks for rating!</p>
        <p className="text-sm text-ink-soft">
          Got more to say?{" "}
          <Link href={feedbackHref(`/s/${sessionId}`, sessionId)} className="text-brand underline">Send feedback</Link>
        </p>
      </Card>
    );
  }

  const low = rating > 0 && rating <= 2;
  return (
    <Card className="flex flex-col gap-3">
      <p className="text-center font-semibold">How did OneTableCircle work for your table?</p>
      <div className="flex justify-center gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}: ${LABELS[n]}`}
            onClick={() => setRating(n)}
            className={`flex size-12 items-center justify-center rounded-xl text-3xl transition-colors active:bg-muted ${
              n <= rating ? "text-warn" : "text-line"
            }`}
          >
            ★
          </button>
        ))}
      </div>
      <p className="h-5 text-center text-sm text-ink-soft">{LABELS[rating]}</p>

      {rating > 0 && (
        <>
          <textarea
            aria-label="Comment (optional)"
            rows={3}
            maxLength={500}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            placeholder={low ? "What went wrong?" : "Anything we could do better? (optional)"}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {error && <Notice tone="error">{error}</Notice>}
          <Button disabled={busy} onClick={send}>{busy ? "Sending…" : "Send rating"}</Button>
        </>
      )}
      <button type="button" className="min-h-10 text-sm text-ink-soft" onClick={notNow}>
        Not now
      </button>
    </Card>
  );
}
