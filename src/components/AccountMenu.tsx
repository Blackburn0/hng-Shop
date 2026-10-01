"use client";

import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { UserIcon } from "@/components/icons";

type Props = { user: { name: string; email: string; avatarUrl: string | null } | null; linkClass: string };

export function AccountMenu({ user, linkClass }: Props) {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  if (!user) {
    const next = encodeURIComponent(`${pathname}${search ? `?${search}` : ""}`);
    return (
      <a href={`/auth/login?next=${next}`} className={`whitespace-nowrap ${linkClass}`}>
        <UserIcon className="size-6 min-[400px]:hidden" />
        <span className="sr-only min-[400px]:not-sr-only">Sign in</span>
      </a>
    );
  }

  return (
    <details className="relative">
      <summary
        className="flex cursor-pointer list-none items-center rounded-full focus-visible:outline-2 focus-visible:outline-paper [&::-webkit-details-marker]:hidden"
        aria-label={`Account: ${user.name}`}
      >
        {user.avatarUrl ? (
          <Image
            src={user.avatarUrl}
            alt=""
            width={44}
            height={44}
            className="size-8 rounded-full border-2 border-paper sm:size-11"
          />
        ) : (
          <span className="grid size-8 place-items-center rounded-full border-2 border-paper font-bold sm:size-11">
            {user.name.charAt(0).toUpperCase()}
          </span>
        )}
      </summary>
      <div className="absolute right-0 z-20 mt-3 w-64 rounded-2xl bg-paper p-4 text-base text-espresso shadow-xl">
        <p className="font-bold">{user.name}</p>
        <p className="truncate text-sm opacity-80">{user.email}</p>
        <form action="/auth/signout" method="post" className="mt-4">
          <button
            type="submit"
            className="w-full rounded-full border-2 border-espresso px-4 py-2 hover:bg-espresso hover:text-paper"
          >
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
