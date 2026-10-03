/**
 * 350000 kobo -> "₦3,500.00". Formatted by hand rather than with Intl, whose
 * currency support varies between Android JavaScript engines.
 */
export function formatNaira(amountMinor: number): string {
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(amountMinor));
  const naira = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const kobo = String(abs % 100).padStart(2, "0");
  return `${sign}₦${naira}.${kobo}`;
}
