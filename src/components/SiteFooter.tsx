import Link from "next/link";
import { Logo } from "@/components/Logo";
import { pillSoft } from "@/components/ui";

const links = [
  { href: "/", label: "our Company" },
  { href: "/products?category=coffee", label: "our Coffee" },
  { href: "/products?category=pastry", label: "our Pastry" },
];

export function SiteFooter() {
  return (
    <footer className="bg-espresso text-paper">
      <div className="mx-auto max-w-[1440px] px-4 pb-8 pt-8 sm:px-8 md:px-14">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <Logo className="text-4xl md:text-5xl" />
          <p className="text-sm">one Stop | one Heart | one Cup</p>
        </div>

        <nav aria-label="Footer" className="mx-auto mt-12 grid max-w-[1220px] gap-6 sm:grid-cols-3 md:mt-20 md:gap-24">
          {links.map((l) => (
            <Link key={l.label} href={l.href} className={`${pillSoft} md:py-5 md:text-2xl`}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-4 text-sm md:mt-28">
          <p>© {new Date().getFullYear()} All Rights Reserved</p>
          <Link href="/privacy" className="underline underline-offset-4 hover:no-underline">
            Privacy policy
          </Link>
        </div>
      </div>
    </footer>
  );
}
