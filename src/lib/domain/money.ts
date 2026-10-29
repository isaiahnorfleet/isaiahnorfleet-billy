/** Money is always integer minor units (cents). Never use floats for stored amounts. */

const CURRENCY_DIGITS: Record<string, number> = { JPY: 0, KRW: 0 };

export function minorDigits(currency: string): number {
  return CURRENCY_DIGITS[currency] ?? 2;
}

/**
 * Parse a user-entered amount such as "1,450", "$79.99" or "112.5" into minor units.
 * Returns null for anything that is not a non-negative amount with at most the currency's decimals.
 */
export function parseAmountToMinor(input: string, currency = "CAD"): number | null {
  const digits = minorDigits(currency);
  const cleaned = input.trim().replace(/[\s,$]/g, "").replace(/^CA\$/i, "");
  if (cleaned === "") return null;
  const re = digits === 0 ? /^\d{1,12}$/ : new RegExp(`^(\\d{1,12})(?:\\.(\\d{0,${digits}}))?$`);
  const match = re.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1] ?? cleaned);
  const frac = digits === 0 ? 0 : Number((match[2] ?? "").padEnd(digits, "0") || "0");
  return whole * 10 ** digits + frac;
}

export function formatMoney(minor: number, currency = "CAD"): string {
  const digits = minorDigits(currency);
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    currencyDisplay: currency === "CAD" ? "narrowSymbol" : "symbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 10 ** digits);
}

/** Value for an <input> field, e.g. 145000 -> "1450.00". */
export function minorToInput(minor: number, currency = "CAD"): string {
  const digits = minorDigits(currency);
  if (digits === 0) return String(minor);
  const whole = Math.floor(minor / 10 ** digits);
  const frac = String(minor % 10 ** digits).padStart(digits, "0");
  return `${whole}.${frac}`;
}

export type MoneyTotals = Record<string, number>;

export function addToTotals(totals: MoneyTotals, currency: string, minor: number): MoneyTotals {
  totals[currency] = (totals[currency] ?? 0) + minor;
  return totals;
}

/** "$1,529.99" or "$1,529.99 + US$12.00" when bills use more than one currency. */
export function formatTotals(totals: MoneyTotals, primary: string): string {
  const keys = Object.keys(totals).filter((k) => totals[k] !== 0);
  if (keys.length === 0) return formatMoney(0, primary);
  keys.sort((a, b) => (a === primary ? -1 : b === primary ? 1 : a.localeCompare(b)));
  return keys.map((k) => formatMoney(totals[k], k)).join(" + ");
}
