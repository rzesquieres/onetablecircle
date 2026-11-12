import type { ReactNode } from "react";
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy · OneTableCircle",
  description: "How OneTableCircle collects, uses and protects your information.",
};

const UPDATED = "November 13, 2026";
const CONTACT = "admin@onetablecircle.com";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 leading-relaxed">
      <div>
        <Link href="/" className="text-sm text-ink-soft">← OneTableCircle</Link>
        <h1 className="mt-2 text-3xl font-semibold">Privacy Policy</h1>
        <p className="text-sm text-ink-soft">Last updated: {UPDATED}</p>
      </div>

      <p>
        OneTableCircle (&quot;we&quot;, &quot;us&quot;) is a web app at onetablecircle.com that lets a group order together at a
        restaurant or café and split the bill. This policy explains what information we collect, why, who helps us process
        it, and the choices you have. We follow the Philippine Data Privacy Act of 2012 (Republic Act No. 10173).
      </p>

      <Section title="Information we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Account details.</strong> If you sign up with email, we store your email address, your name and a
            password (stored securely by our authentication provider; we never see it). If you use &quot;Continue with
            Google&quot;, Google shares your name, email address and profile picture with us. We don&apos;t receive your
            Google password or access to anything else in your Google account.
          </li>
          <li>
            <strong>Guest use.</strong> If you join a table as a guest, we store only the name you type and a random
            identifier kept on your device.
          </li>
          <li>
            <strong>Table and order information.</strong> The tables you start or join, the names of people at the table,
            what was ordered and for whom, notes, which items were served, and your share of the bill.
          </li>
          <li>
            <strong>Receipt photos.</strong> When a host scans a receipt, we store the photo so people at that table can
            check the bill.
          </li>
          <li>
            <strong>Payment QR code.</strong> If you choose to upload a GCash or Maya QR image, we store it so people at
            tables you host can pay you. The image has an unguessable web link; anyone who is given that link can view it.
          </li>
          <li>
            <strong>Saved groups and favourites.</strong> Groups of people you save for quick setup, and your &quot;usual&quot;
            orders.
          </li>
          <li>
            <strong>Problem reports.</strong> If you report a wrong menu item or price, we store your report.
          </li>
          <li>
            <strong>Feedback and ratings.</strong> If you send feedback or rate a table after the meal, we store your message or rating, your name, the page you sent it from,
            the table you were at (if any), your browser type, and your email if you asked us to reply.
          </li>
          <li>
            <strong>Technical information.</strong> Our hosting and database providers keep standard server logs (such as
            IP address, browser type and time of request) for security and troubleshooting.
          </li>
        </ul>
        <p>
          <strong>We do not process payments</strong> and never collect bank, card, GCash or Maya account credentials.
          People pay each other outside the app.
        </p>
      </Section>

      <Section title="How we use your information">
        <ul className="list-disc space-y-2 pl-5">
          <li>To run the app: create tables, show orders to the people at the same table, track what was served, and work out each person&apos;s share of the bill.</li>
          <li>To sign you in and keep your account secure.</li>
          <li>To read receipts and printed menus automatically (see &quot;AI processing&quot; below).</li>
          <li>To fix problems, prevent abuse, and improve the app using counts that don&apos;t identify you (for example, how many tables were started each week).</li>
        </ul>
        <p>We do not sell your information, and we do not use it for advertising.</p>
      </Section>

      <Section title="Who can see your information">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>People at the same table</strong> see your name, what you ordered, the receipt, everyone&apos;s share of
            the bill and who has paid. People who are not at that table cannot see it.
          </li>
          <li>
            <strong>Our administrators</strong> can manage stores and menus, review problem reports and feedback, and see overall counts.
          </li>
          <li>
            <strong>Service providers</strong> who process data on our behalf, only to run the app:
            <ul className="mt-1 list-[circle] space-y-1 pl-5">
              <li>Supabase: database, sign-in and file storage (servers in Singapore).</li>
              <li>Hostinger: website hosting.</li>
              <li>
                Anthropic (Claude): reads receipt photos and menu photos, PDFs or web pages to extract items and prices.
                Anthropic processes this content to return a result to us and does not use it to train its models under
                its commercial terms.
              </li>
              <li>Google: only if you choose &quot;Continue with Google&quot;.</li>
            </ul>
          </li>
          <li>Authorities, if required by law.</li>
        </ul>
      </Section>

      <Section title="AI processing">
        <p>
          When a host scans a receipt, or an administrator imports a menu, the image, document or web page is sent to
          Anthropic&apos;s Claude AI to read the items and prices. The result is always shown to a person to check and
          correct before it is used. Please avoid photographing personal information other than what&apos;s on the receipt.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          We use only the cookies and browser storage needed to keep you signed in and remember small settings. We do not
          use advertising or third-party tracking cookies.
        </p>
      </Section>

      <Section title="How long we keep information">
        <p>
          We keep your account and table history while your account exists, so you can see past tables and what you paid.
          You can ask us to delete your account and the information linked to it at any time (see below). Some information
          may stay in backups for a short period, and we may keep information longer if the law requires it.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Under the Data Privacy Act you can ask to be informed about, access, correct, or delete your personal
          information, object to its processing, and receive a copy of it. You can also lodge a complaint with the National
          Privacy Commission (privacy.gov.ph). To make a request, email us at{" "}
          <a href={`mailto:${CONTACT}`} className="text-brand underline">{CONTACT}</a>. You can change your name and payment
          QR code yourself on your Profile page.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Information is sent over encrypted connections (HTTPS). Database rules make sure people can only see tables they
          belong to, receipt photos are private to the people at the table, and passwords are handled by our
          authentication provider. No system is perfectly secure, but we work to protect your information.
        </p>
      </Section>

      <Section title="Children">
        <p>OneTableCircle is not intended for children under 13, and we do not knowingly collect their information.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          If we change this policy, we will update the date at the top of this page. If the changes are significant, we
          will let users know in the app.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions or requests about privacy:{" "}
          <a href={`mailto:${CONTACT}`} className="text-brand underline">{CONTACT}</a>
        </p>
      </Section>
    </main>
  );
}
