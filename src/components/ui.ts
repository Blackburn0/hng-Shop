// Shared class strings for the pill buttons in Design/button_*.svg.
// Outline pill: white fill, thick espresso border, espresso text.
export const pillOutline =
  "inline-flex items-center justify-center gap-2 rounded-full border-4 border-espresso bg-paper px-8 " +
  "font-body text-espresso transition-colors hover:bg-espresso hover:text-paper " +
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-espresso " +
  "disabled:cursor-not-allowed disabled:opacity-60";

// Footer pill: light grey, soft drop shadow.
export const pillSoft =
  "inline-flex items-center justify-center rounded-full bg-pill px-6 py-4 font-body text-xl text-espresso " +
  "shadow-[4px_4px_8px_rgba(0,0,0,0.45)] transition-transform hover:-translate-y-0.5 " +
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-paper";
