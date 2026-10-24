/**
 * Chart-of-accounts catalog and voucher vocabulary.
 *
 * The 28 groups below mirror Tally's predefined group set, including each
 * group's parent and natural balance direction, so a Tally XML master export
 * can be imported without inventing a new hierarchy. Groups carry a `nature`
 * (assets / liabilities / income / expense) that decides which statement they
 * roll into and how a closing balance is read.
 */

/** @typedef {'assets'|'liabilities'|'income'|'expense'} Nature */

/**
 * @typedef {object} GroupDefinition
 * @property {string} name
 * @property {string|null} parent
 * @property {Nature} nature
 * @property {'Dr'|'Cr'} natural
 */

const VOUCHER_SAFE_GROUPS = ["Cash-in-Hand", "Bank Accounts", "Bank OD A/c"];

/** @type {GroupDefinition[]} */
export const GROUPS = [
  {
    name: "Capital Account",
    parent: null,
    nature: "liabilities",
    natural: "Cr",
  },
  {
    name: "Loans (Liability)",
    parent: null,
    nature: "liabilities",
    natural: "Cr",
  },
  {
    name: "Current Liabilities",
    parent: null,
    nature: "liabilities",
    natural: "Cr",
  },
  { name: "Fixed Assets", parent: null, nature: "assets", natural: "Dr" },
  { name: "Investments", parent: null, nature: "assets", natural: "Dr" },
  { name: "Current Assets", parent: null, nature: "assets", natural: "Dr" },
  { name: "Branch/Divisions", parent: null, nature: "assets", natural: "Dr" },
  {
    name: "Misc. Expenses (ASSET)",
    parent: null,
    nature: "assets",
    natural: "Dr",
  },
  { name: "Suspense A/c", parent: null, nature: "assets", natural: "Dr" },
  { name: "Sales Accounts", parent: null, nature: "income", natural: "Cr" },
  { name: "Purchase Accounts", parent: null, nature: "expense", natural: "Dr" },
  { name: "Direct Incomes", parent: null, nature: "income", natural: "Cr" },
  { name: "Indirect Incomes", parent: null, nature: "income", natural: "Cr" },
  { name: "Direct Expenses", parent: null, nature: "expense", natural: "Dr" },
  { name: "Indirect Expenses", parent: null, nature: "expense", natural: "Dr" },
  {
    name: "Profit & Loss A/c",
    parent: null,
    nature: "liabilities",
    natural: "Cr",
  },

  {
    name: "Bank Accounts",
    parent: "Current Assets",
    nature: "assets",
    natural: "Dr",
  },
  {
    name: "Bank OD A/c",
    parent: "Loans (Liability)",
    nature: "liabilities",
    natural: "Cr",
  },
  {
    name: "Cash-in-Hand",
    parent: "Current Assets",
    nature: "assets",
    natural: "Dr",
  },
  {
    name: "Deposits (Asset)",
    parent: "Current Assets",
    nature: "assets",
    natural: "Dr",
  },
  {
    name: "Loans & Advances (Asset)",
    parent: "Current Assets",
    nature: "assets",
    natural: "Dr",
  },
  {
    name: "Stock-in-Hand",
    parent: "Current Assets",
    nature: "assets",
    natural: "Dr",
  },
  {
    name: "Sundry Debtors",
    parent: "Current Assets",
    nature: "assets",
    natural: "Dr",
  },
  {
    name: "Duties & Taxes",
    parent: "Current Liabilities",
    nature: "liabilities",
    natural: "Cr",
  },
  {
    name: "Provisions",
    parent: "Current Liabilities",
    nature: "liabilities",
    natural: "Cr",
  },
  {
    name: "Sundry Creditors",
    parent: "Current Liabilities",
    nature: "liabilities",
    natural: "Cr",
  },
  {
    name: "Secured Loans",
    parent: "Loans (Liability)",
    nature: "liabilities",
    natural: "Cr",
  },
  {
    name: "Unsecured Loans",
    parent: "Loans (Liability)",
    nature: "liabilities",
    natural: "Cr",
  },
];

export const PRIMARY_GROUP_NAMES = GROUPS.filter(
  (group) => group.parent === null,
).map((group) => group.name);

export const GROUPS_BY_NAME = new Map(
  GROUPS.map((group) => [group.name, group]),
);

/** Statement a group's closing balance is presented in. */
export function statementFor(groupName) {
  const group = GROUPS_BY_NAME.get(groupName);
  if (group === undefined) return "balance_sheet";
  return group.nature === "income" || group.nature === "expense"
    ? "profit_loss"
    : "balance_sheet";
}

/**
 * Tally's report split for P&L groups. Returns null for balance-sheet groups
 * so callers never treat a capital or asset group as an expense.
 */
export function profitLossSectionFor(groupName) {
  const group = GROUPS_BY_NAME.get(groupName);
  if (group === undefined) return null;
  if (group.nature === "income") {
    return groupName === "Sales Accounts" || groupName === "Direct Incomes"
      ? "direct_income"
      : "indirect_income";
  }
  if (group.nature === "expense") {
    return groupName === "Purchase Accounts" || groupName === "Direct Expenses"
      ? "direct_expense"
      : "indirect_expense";
  }
  return null;
}

/**
 * Voucher types, in Tally Prime's order and with its function keys.
 * `requires` drives non-blocking warnings so a voucher that is legal in
 * Tally (a journal touching any two ledgers) is never rejected here.
 */
export const VOUCHER_TYPES = [
  {
    code: "CONTRA",
    name: "Contra",
    shortcut: "F4",
    prefix: "CON",
    group: "accounting",
    requires: {
      anyOf: VOUCHER_SAFE_GROUPS,
      hint: "Contra vouchers normally move cash or bank balances",
    },
  },
  {
    code: "PAYMENT",
    name: "Payment",
    shortcut: "F5",
    prefix: "PAY",
    group: "accounting",
    requires: {
      anyOf: VOUCHER_SAFE_GROUPS,
      hint: "Payment vouchers normally credit cash or bank",
    },
  },
  {
    code: "RECEIPT",
    name: "Receipt",
    shortcut: "F6",
    prefix: "RCP",
    group: "accounting",
    requires: {
      anyOf: VOUCHER_SAFE_GROUPS,
      hint: "Receipt vouchers normally debit cash or bank",
    },
  },
  {
    code: "JOURNAL",
    name: "Journal",
    shortcut: "F7",
    prefix: "JRN",
    group: "accounting",
    requires: null,
  },
  {
    code: "SALES",
    name: "Sales",
    shortcut: "F8",
    prefix: "SAL",
    group: "accounting",
    requires: {
      anyOf: ["Sales Accounts"],
      hint: "Sales vouchers normally credit a Sales Accounts ledger",
    },
  },
  {
    code: "PURCHASE",
    name: "Purchase",
    shortcut: "F9",
    prefix: "PUR",
    group: "accounting",
    requires: {
      anyOf: ["Purchase Accounts"],
      hint: "Purchase vouchers normally debit a Purchase Accounts ledger",
    },
  },
  {
    code: "CREDIT_NOTE",
    name: "Credit Note",
    shortcut: "Alt+F5",
    prefix: "CRN",
    group: "accounting",
    requires: {
      anyOf: ["Sales Accounts"],
      hint: "A credit note reverses a sale",
    },
  },
  {
    code: "DEBIT_NOTE",
    name: "Debit Note",
    shortcut: "Alt+F6",
    prefix: "DBN",
    group: "accounting",
    requires: {
      anyOf: ["Purchase Accounts"],
      hint: "A debit note reverses a purchase",
    },
  },
];

export const VOUCHER_TYPES_BY_CODE = new Map(
  VOUCHER_TYPES.map((type) => [type.code, type]),
);
export const VOUCHER_TYPES_BY_NAME = new Map(
  VOUCHER_TYPES.map((type) => [type.name, type]),
);
export const VOUCHER_TYPES_BY_SHORTCUT = new Map(
  VOUCHER_TYPES.map((type) => [type.shortcut, type]),
);

/** Function keys that open a voucher screen, ordered for the command bar. */
export const VOUCHER_SHORTCUTS = VOUCHER_TYPES.map((type) => ({
  key: type.shortcut,
  code: type.code,
  label: type.name,
}));

export const UNITS = [
  "Nos",
  "Pcs",
  "Kg",
  "Gm",
  "Ltr",
  "Mtr",
  "Box",
  "Set",
  "Dozen",
  "Bag",
];

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];
