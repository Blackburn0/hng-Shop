import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/supabase/request";

export const metadata: Metadata = { title: "Sign in" };

const messages: Record<string, string> = {
  access_denied: "Google sign-in was cancelled. You can try again whenever you're ready.",
  missing_code: "That sign-in link was incomplete. Please try again.",
  exchange_failed: "We couldn't finish signing you in — the link may have expired. Please try again.",
  unavailable: "Google sign-in isn't available right now. Please try again in a moment.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext);
  if (await getCurrentUser()) redirect(next);

  const message = error ? (messages[error] ?? messages.exchange_failed) : null;

  return (
    <section className="grid place-items-center px-4 py-20 md:py-32">
      <div className="w-full max-w-md rounded-[2rem] bg-espresso px-8 py-12 text-center text-paper">
        <h1 className="font-display text-4xl font-bold md:text-5xl">Sign in</h1>
        <p className="mt-4 text-lg">Sign in to check out and see your orders.</p>

        {message && (
          <p role="alert" className="mt-6 rounded-2xl bg-paper/15 px-4 py-3 text-base">
            {message}
          </p>
        )}

        <a
          href={`/auth/login?next=${encodeURIComponent(next)}`}
          className="mt-8 inline-flex h-14 w-full items-center justify-center gap-3 rounded-full bg-paper px-6 text-lg font-bold text-espresso transition hover:bg-pill focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-paper"
        >
          <GoogleIcon />
          Continue with Google
        </a>
      </div>
    </section>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-6">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
