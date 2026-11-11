import Link from "next/link";
import { YouTubeChannelLink } from "@/components/youtube-link";
import { Card } from "@/components/ui";
import { WaitlistForm } from "./waitlist-form";

export const metadata = {
  title: "Pricing · OneTableCircle",
  description: "OneTableCircle is free for every table. Circle Plus adds extras for the person who always organises.",
};

// Edit these lists to change what each plan shows. Nothing here locks features
// in the app yet: everything is free while OneTableCircle is in testing.
const FREE_FEATURES = [
  "Start a table and invite friends by QR code or link",
  "Friends join as guests with just their name",
  "Everyone orders from their own phone",
  "One clean list for the waiter",
  "Fair split with shared items, VAT and service charge",
];

const PLUS_FEATURES = [
  "Receipt scanning that fills in the bill for you",
  "Saved groups and favourite orders",
  "Full table history and monthly spending",
  "Payment reminders for anyone who hasn't paid (coming soon)",
  "Export a table's bill to PDF or CSV (coming soon)",
];

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {items.map((f) => (
        <li key={f} className="flex gap-2">
          <span aria-hidden className="text-brand">✓</span>
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}

export default function PricingPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
      <div>
        <Link href="/" className="text-sm text-ink-soft">← OneTableCircle</Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Pricing</h1>
        <p className="mt-1 text-ink-soft">Free for every table. Plus is for the person who always organises.</p>
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Free</h2>
          <span className="text-lg font-semibold">₱0</span>
        </div>
        <FeatureList items={FREE_FEATURES} />
      </Card>

      <Card className="flex flex-col gap-3 border-brand">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold">Circle Plus</h2>
          <span className="text-right">
            <span className="block text-lg font-semibold">₱99/month</span>
            <span className="text-sm text-ink-soft">or ₱799/year</span>
          </span>
        </div>
        <p className="text-sm text-ink-soft">Everything in Free, plus:</p>
        <FeatureList items={PLUS_FEATURES} />
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Join the Circle Plus waitlist</h2>
        <p className="text-sm text-ink-soft">
          Everything is free while we&apos;re testing. Leave your email and we&apos;ll tell you when Plus launches.
        </p>
        <WaitlistForm />
      </section>

      <footer className="mt-auto pt-6 text-center text-xs text-ink-soft">
        <Link href="/terms" className="underline">Terms of Service</Link> ·{" "}
        <Link href="/privacy" className="underline">Privacy Policy</Link> ·{" "}
        <YouTubeChannelLink />
      </footer>
    </main>
  );
}
