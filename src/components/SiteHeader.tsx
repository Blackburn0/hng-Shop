import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { Suspense } from "react";
import { AccountMenu } from "@/components/AccountMenu";
import { CartLink } from "@/components/CartLink";
import { Logo } from "@/components/Logo";

const navLink = "hover:underline underline-offset-8 decoration-2 focus-visible:outline-2 focus-visible:outline-paper";

function accountFor(user: User | null) {
  if (!user) return null;
  const meta = user.user_metadata as { full_name?: string; name?: string; avatar_url?: string };
  return {
    name: meta.full_name ?? meta.name ?? user.email ?? "Account",
    email: user.email ?? "",
    avatarUrl: meta.avatar_url ?? null,
  };
}

export function SiteHeader({ user }: { user: User | null }) {
  return (
    <header className="bg-espresso text-paper">
      <nav
        aria-label="Main"
        className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-4 sm:px-8 md:h-28 md:px-14"
      >
        <Logo className="text-2xl min-[400px]:text-3xl sm:text-4xl lg:text-6xl" />
        <div className="flex items-center gap-4 whitespace-nowrap font-body text-sm min-[400px]:text-base sm:gap-8 sm:text-2xl lg:gap-11 lg:text-4xl">
          <Link href="/products" className={navLink}>
            Products
          </Link>
          <CartLink className={navLink} />
          <Suspense fallback={null}>
            <AccountMenu user={accountFor(user)} linkClass={navLink} />
          </Suspense>
        </div>
      </nav>
    </header>
  );
}
