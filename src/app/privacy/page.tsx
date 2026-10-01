import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy policy" };

// Linked from the footer and from the Google sign-in consent screen
// (Google Auth Platform → Branding → Privacy policy link).
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 sm:px-8 md:py-20">
      <h1 className="font-display text-4xl font-bold md:text-5xl">Privacy policy</h1>
      <p className="mt-3 text-sm opacity-75">Last updated 1 October 2026</p>

      <p className="mt-8 text-lg leading-relaxed">
        Coffee Shop is a demonstration online shop. Payments run in Paystack&apos;s <strong>test mode</strong>, so no real
        money changes hands. This page explains what we collect when you use it and why.
      </p>

      <Section title="What we collect">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>From Google sign-in:</strong> your name, email address and profile photo. We use them to identify your
            account and to send your order confirmation.
          </li>
          <li>
            <strong>When you check out:</strong> the delivery name, phone number and address you enter, and what you
            ordered.
          </li>
          <li>
            <strong>Your cart:</strong> kept in your browser until you sign in, then saved to your account.
          </li>
          <li>
            <strong>Technical logs:</strong> request times, pages and error details, with email addresses, phone numbers
            and addresses removed. Logs are used to keep the site working and secure.
          </li>
        </ul>
      </Section>

      <Section title="What we don't collect">
        <p>
          We never see or store card details. Card payments are entered on Paystack&apos;s own checkout page and handled
          entirely by Paystack.
        </p>
      </Section>

      <Section title="Who processes your data">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Supabase:</strong> stores your account, cart and orders.
          </li>
          <li>
            <strong>Google:</strong> signs you in.
          </li>
          <li>
            <strong>Paystack:</strong> processes card payments (test mode).
          </li>
          <li>
            <strong>Mailgun and Gmail:</strong> deliver order confirmation emails.
          </li>
          <li>
            <strong>Vercel:</strong> hosts the website.
          </li>
        </ul>
        <p className="mt-4">We don&apos;t sell your data or use it for advertising.</p>
      </Section>

      <Section title="Your choices">
        <p>
          You can sign out at any time from the account menu. To have your account and orders deleted, reply to any order
          confirmation email and ask. We&apos;ll remove them and confirm by email.
        </p>
      </Section>

      <Link href="/products" className="mt-12 inline-block underline underline-offset-4">
        Back to the shop
      </Link>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 text-lg leading-relaxed">
      <h2 className="font-body text-2xl font-extrabold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
