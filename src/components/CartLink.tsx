"use client";

import Link from "next/link";
import { useGuestCart } from "@/lib/guest-cart";

export function CartLink({ className = "" }: { className?: string }) {
  const { count } = useGuestCart();
  return (
    <Link href="/checkout" className={`relative ${className}`}>
      Checkout
      {count > 0 && (
        <span
          className="absolute -right-3 -top-3 grid min-w-6 place-items-center rounded-full bg-paper px-1.5 text-sm font-bold text-espresso"
          aria-label={`${count} item${count === 1 ? "" : "s"} in cart`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
