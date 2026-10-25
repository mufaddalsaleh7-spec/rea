/** Number and date presentation. Indian grouping, paise-precise, never floats. */

const AMOUNT = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const QUANTITY = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const COMPACT = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return AMOUNT.format(number);
}

export function rupee(value) {
  return `₹${money(value)}`;
}

export function compactRupee(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `₹${COMPACT.format(number)}`;
}

export function qty(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return QUANTITY.format(number);
}

export function drcr(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return money(0);
  return `${money(Math.abs(number))} ${number > 0 ? "Dr" : "Cr"}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** "2026-04-01" → "01 Apr 2026". Parsed as text so no timezone drift. */
export function prettyDate(iso) {
  if (typeof iso !== "string") return "—";
  const [year, month, day] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const name = months[Number(month) - 1];
  if (!name) return iso;
  return `${day} ${name} ${year}`;
}

export function shiftDate(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Sum a list of rupee amounts and round the way the backend does. */
export function total(values) {
  const sum = values.reduce((accumulator, value) => accumulator + Number(value || 0), 0);
  return Math.round(sum * 100) / 100;
}
