// Small line icons used in the header on narrow screens.
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function CartIcon({ className = "size-6" }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" />
      <circle cx="10" cy="20.5" r="1" />
      <circle cx="17" cy="20.5" r="1" />
    </svg>
  );
}

export function UserIcon({ className = "size-6" }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
