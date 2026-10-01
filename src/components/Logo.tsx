import Link from "next/link";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`font-script whitespace-nowrap text-paper focus-visible:outline-2 focus-visible:outline-paper ${className}`}
    >
      Coffee Shop
    </Link>
  );
}
