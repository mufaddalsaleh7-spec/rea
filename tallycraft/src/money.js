/**
 * Money handling for TallyCraft.
 *
 * All monetary values are integer paise. Never accumulate floating point.
 * The sign convention is shared by the whole application: debit is positive,
 * credit is negative. A ledger's balance is therefore `opening + movements`
 * and a trial balance is balanced exactly when every balance sums to zero.
 */

export const PAISE_PER_RUPEE = 100;

const AMOUNT_PATTERN = /^[-+]?(?:\d{1,3}(?:,\d{2,3})*|\d+)(?:\.(\d{0,2}))?$/;

/** Convert a finite rupee number to integer paise. */
export function toPaise(rupees) {
  if (!Number.isFinite(rupees)) {
    throw new TypeError("Amount must be a finite number");
  }
  return Math.round(rupees * PAISE_PER_RUPEE);
}

/** Convert integer paise to a rupee number. Lossy; prefer formatPaise. */
export function toRupees(paise) {
  return paise / PAISE_PER_RUPEE;
}

/**
 * Parse a human entry such as "1,23,456.78", "500", "-250.5" or "12." into
 * integer paise. Returns null when the text is not an unambiguous amount.
 */
export function parseAmount(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!AMOUNT_PATTERN.test(trimmed)) return null;
  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^[-+]/, "").replaceAll(",", "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const paise =
    Number(whole) * PAISE_PER_RUPEE + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) return null;
  return negative ? -paise : paise;
}

/** Format integer paise using Indian digit grouping: 12,34,56,789.00 */
export function formatPaise(paise, options = {}) {
  const { showSymbol = false, blankZero = false, decimals = 2 } = options;
  const value = Number.isFinite(paise) ? Math.trunc(paise) : 0;
  if (blankZero && value === 0) return "";
  const negative = value < 0;
  const absolute = Math.abs(value);
  const whole = Math.trunc(absolute / PAISE_PER_RUPEE);
  const fraction = absolute % PAISE_PER_RUPEE;
  const grouped = groupIndian(String(whole));
  const body =
    decimals === 0
      ? grouped
      : `${grouped}.${String(fraction).padStart(2, "0")}`;
  const sign = negative ? "-" : "";
  return `${sign}${showSymbol ? "\u20b9" : ""}${body}`;
}

function groupIndian(digits) {
  if (digits.length <= 3) return digits;
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}`;
}

/** Render a signed balance in Tally's Dr/Cr notation. */
export function formatDrCr(paise, options = {}) {
  const amount = formatPaise(Math.abs(paise), options);
  if (paise === 0) return amount;
  return `${amount} ${paise > 0 ? "Dr" : "Cr"}`;
}

/** Sum paise values without losing integer precision. */
export function sumPaise(values) {
  let total = 0;
  for (const value of values) total += Math.trunc(value);
  return total;
}

/** True when a signed amount behaves as a debit. */
export function isDebit(paise) {
  return paise > 0;
}
