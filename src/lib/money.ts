const formatters = new Map<string, Intl.NumberFormat>();

/** 350000 kobo -> "₦3,500.00" */
export function formatMoney(amountMinor: number, currency = "NGN"): string {
  let fmt = formatters.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-NG", { style: "currency", currency, currencyDisplay: "narrowSymbol" });
    formatters.set(currency, fmt);
  }
  return fmt.format(amountMinor / 100);
}
