import type { ReactNode } from "react";
import Link from "next/link";

export const metadata = {
  title: "Terms of Service · OneTableCircle",
  description: "The rules for using OneTableCircle.",
};

const UPDATED = "November 11, 2026";
const CONTACT = "admin@onetablecircle.com";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function TermsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 leading-relaxed">
      <div>
        <Link href="/" className="text-sm text-ink-soft">← OneTableCircle</Link>
        <h1 className="mt-2 text-3xl font-semibold">Terms of Service</h1>
        <p className="text-sm text-ink-soft">Last updated: {UPDATED}</p>
      </div>

      <p>
        These terms apply when you use OneTableCircle at onetablecircle.com (&quot;the app&quot;, &quot;we&quot;, &quot;us&quot;).
        By creating an account, joining a table as a guest, or otherwise using the app, you agree to them. If you
        don&apos;t agree, please don&apos;t use the app.
      </p>

      <Section title="What the app does">
        <p>
          OneTableCircle helps a group order together at a restaurant or café and work out who owes what. It is a
          calculation and coordination tool. We are not the restaurant, we don&apos;t take orders on a restaurant&apos;s
          behalf, and we don&apos;t sell food or drinks.
        </p>
      </Section>

      <Section title="Payments between people">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>We don&apos;t process payments.</strong> People pay the restaurant and each other directly, for example
            in cash, GCash or Maya. We are not a party to those payments and can&apos;t refund or reverse them.
          </li>
          <li>
            Split amounts are based on what people entered and on menu or receipt details, which may be read automatically
            and can contain mistakes. The restaurant&apos;s official bill is what counts. Please check amounts before you
            pay.
          </li>
          <li>Any disagreement about who owes what is between the people at the table.</li>
        </ul>
      </Section>

      <Section title="Accounts and guests">
        <ul className="list-disc space-y-2 pl-5">
          <li>Give accurate information and keep your sign-in details to yourself. You are responsible for activity on your account.</li>
          <li>Guests can join a table with just a name. A guest&apos;s tables are kept on that device only.</li>
          <li>While the app is in testing, hosting tables may be limited to invited people.</li>
        </ul>
      </Section>

      <Section title="Acceptable use">
        <p>Please don&apos;t:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>use the app for anything unlawful, or to harass or mislead other people;</li>
          <li>upload content you don&apos;t have the right to share, or images with other people&apos;s private information;</li>
          <li>try to access tables or data that aren&apos;t yours, or disrupt or overload the app;</li>
          <li>copy, resell or scrape the app or its menu data.</li>
        </ul>
        <p>We may suspend or remove accounts, tables or content that break these rules.</p>
      </Section>

      <Section title="Your content">
        <p>
          You keep ownership of what you add, such as names, orders, receipt photos and payment QR codes. You let us store
          and show it to the people at the same table, and process it as described in our{" "}
          <Link href="/privacy" className="text-brand underline">Privacy Policy</Link>, so the app can work.
        </p>
      </Section>

      <Section title="Paid plans">
        <p>
          OneTableCircle is free while it is in testing. If we introduce a paid plan such as Circle Plus, we will show the
          price, what it includes, and how billing and cancellation work before you can buy it. Joining the waitlist
          doesn&apos;t commit you to paying.
        </p>
      </Section>

      <Section title="Availability and changes">
        <p>
          We work to keep the app running, but it is provided &quot;as is&quot; and may sometimes be unavailable, change, or
          lose features. We may update these terms; if we do, we&apos;ll change the date at the top, and tell users in the
          app if the changes are significant. Continuing to use the app after that means you accept the new terms.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          To the extent the law allows, we are not liable for indirect or consequential losses, or for losses caused by
          incorrect amounts, payments made between users, or the app being unavailable. Nothing in these terms limits
          rights you have under Philippine consumer protection law that can&apos;t be waived.
        </p>
      </Section>

      <Section title="Governing law">
        <p>These terms are governed by the laws of the Republic of the Philippines.</p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about these terms:{" "}
          <a href={`mailto:${CONTACT}`} className="text-brand underline">{CONTACT}</a>
        </p>
      </Section>
    </main>
  );
}
