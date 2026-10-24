/**
 * Demo data: a small Surat textile trader with an April 2026 financial year.
 * Amounts are chosen so every bank and cash balance stays positive and the
 * GST liability clears each month; the seed is deterministic, so tests can
 * assert exact totals.
 */

const LEDGERS = [
  {
    name: "Share Capital",
    group: "Capital Account",
    opening: 24_39_500,
    type: "Cr",
  },
  {
    name: "Director's Loan",
    group: "Unsecured Loans",
    opening: 5_00_000,
    type: "Cr",
  },
  {
    name: "Plant & Machinery",
    group: "Fixed Assets",
    opening: 12_00_000,
    type: "Dr",
  },
  {
    name: "Furniture & Fixtures",
    group: "Fixed Assets",
    opening: 1_50_000,
    type: "Dr",
  },
  {
    name: "HDFC Bank - Current A/c",
    group: "Bank Accounts",
    opening: 8_50_000,
    type: "Dr",
    gstin: null,
  },
  { name: "Cash", group: "Cash-in-Hand", opening: 75_000, type: "Dr" },
  {
    name: "Stock-in-Hand",
    group: "Stock-in-Hand",
    opening: 7_41_000,
    type: "Dr",
  },

  {
    name: "Ravi Textiles",
    group: "Sundry Debtors",
    opening: 1_25_000,
    type: "Dr",
    gstin: "24AABCR1234M1Z5",
  },
  {
    name: "Meera Fashion House",
    group: "Sundry Debtors",
    opening: 86_500,
    type: "Dr",
  },
  {
    name: "Nakoda Garments",
    group: "Sundry Debtors",
    opening: 42_000,
    type: "Dr",
  },
  { name: "Shreeji Boutique", group: "Sundry Debtors", opening: 0, type: "Dr" },

  {
    name: "Surat Weaving Mills",
    group: "Sundry Creditors",
    opening: 1_80_000,
    type: "Cr",
  },
  {
    name: "Krishna Yarn Traders",
    group: "Sundry Creditors",
    opening: 96_000,
    type: "Cr",
  },
  {
    name: "Dye Master Processors",
    group: "Sundry Creditors",
    opening: 54_000,
    type: "Cr",
  },
  {
    name: "Riddhi Transport",
    group: "Sundry Creditors",
    opening: 0,
    type: "Cr",
  },

  { name: "Output CGST", group: "Duties & Taxes", opening: 0, type: "Cr" },
  { name: "Output SGST", group: "Duties & Taxes", opening: 0, type: "Cr" },
  { name: "Input CGST", group: "Duties & Taxes", opening: 0, type: "Dr" },
  { name: "Input SGST", group: "Duties & Taxes", opening: 0, type: "Dr" },
  { name: "GST Payable", group: "Duties & Taxes", opening: 0, type: "Cr" },
  { name: "Salary Payable", group: "Provisions", opening: 0, type: "Cr" },

  { name: "Sales - Fabric", group: "Sales Accounts", opening: 0, type: "Cr" },
  { name: "Sales - Garments", group: "Sales Accounts", opening: 0, type: "Cr" },
  { name: "Sales Returns", group: "Sales Accounts", opening: 0, type: "Dr" },
  {
    name: "Purchase - Fabric",
    group: "Purchase Accounts",
    opening: 0,
    type: "Dr",
  },
  {
    name: "Purchase - Garments",
    group: "Purchase Accounts",
    opening: 0,
    type: "Dr",
  },

  {
    name: "Discount Received",
    group: "Indirect Incomes",
    opening: 0,
    type: "Cr",
  },
  {
    name: "Interest Received",
    group: "Indirect Incomes",
    opening: 0,
    type: "Cr",
  },
  { name: "Freight Inward", group: "Direct Expenses", opening: 0, type: "Dr" },
  { name: "Salary", group: "Indirect Expenses", opening: 0, type: "Dr" },
  { name: "Rent", group: "Indirect Expenses", opening: 0, type: "Dr" },
  { name: "Electricity", group: "Indirect Expenses", opening: 0, type: "Dr" },
  {
    name: "Transport Charges",
    group: "Indirect Expenses",
    opening: 0,
    type: "Dr",
  },
  {
    name: "Telephone & Internet",
    group: "Indirect Expenses",
    opening: 0,
    type: "Dr",
  },
  { name: "Bank Charges", group: "Indirect Expenses", opening: 0, type: "Dr" },
  {
    name: "Printing & Stationery",
    group: "Indirect Expenses",
    opening: 0,
    type: "Dr",
  },
  { name: "Depreciation", group: "Indirect Expenses", opening: 0, type: "Dr" },
];

const STOCK_ITEMS = [
  {
    name: "Cotton Fabric 44in",
    stockGroup: "Fabric",
    unit: "Mtr",
    openingQty: 2_400,
    openingValue: 1_92_000,
    gstRate: 5,
    hsn: "5208",
  },
  {
    name: "Linen Fabric 58in",
    stockGroup: "Fabric",
    unit: "Mtr",
    openingQty: 1_200,
    openingValue: 1_44_000,
    gstRate: 5,
    hsn: "5309",
  },
  {
    name: "Stitched Shirt",
    stockGroup: "Garments",
    unit: "Pcs",
    openingQty: 900,
    openingValue: 4_05_000,
    gstRate: 12,
    hsn: "6205",
  },
];

/**
 * Voucher lines are written from the operator's point of view:
 * `dr` is a debit ledger, `cr` a credit ledger, amounts in rupees.
 */
const VOUCHERS = [
  {
    type: "SALES",
    date: "2026-04-03",
    number: "SAL-0001",
    party: "Ravi Textiles",
    narration: "Fabric supply - invoice RT/104",
    lines: [
      { dr: "Ravi Textiles", amount: 1_93_200 },
      { cr: "Sales - Fabric", amount: 1_84_000 },
      { cr: "Output CGST", amount: 4_600 },
      { cr: "Output SGST", amount: 4_600 },
    ],
    inventory: [{ item: "Cotton Fabric 44in", qty: 1_600, rate: 115 }],
  },
  {
    type: "PURCHASE",
    date: "2026-04-05",
    number: "PUR-0001",
    party: "Surat Weaving Mills",
    narration: "Grey fabric purchase - bill SWM/2081",
    lines: [
      { dr: "Purchase - Fabric", amount: 1_50_000 },
      { dr: "Input CGST", amount: 3_750 },
      { dr: "Input SGST", amount: 3_750 },
      { cr: "Surat Weaving Mills", amount: 1_57_500 },
    ],
    inventory: [{ item: "Cotton Fabric 44in", qty: 1_800, rate: 83.33 }],
  },
  {
    type: "RECEIPT",
    date: "2026-04-12",
    number: "RCP-0001",
    party: "Meera Fashion House",
    narration: "Part payment received by NEFT",
    lines: [
      { dr: "HDFC Bank - Current A/c", amount: 80_000 },
      { cr: "Meera Fashion House", amount: 80_000 },
    ],
  },
  {
    type: "PAYMENT",
    date: "2026-04-15",
    number: "PAY-0001",
    party: "Surat Weaving Mills",
    narration: "Part payment against SWM/2081",
    lines: [
      { dr: "Surat Weaving Mills", amount: 1_00_000 },
      { cr: "HDFC Bank - Current A/c", amount: 1_00_000 },
    ],
  },
  {
    type: "JOURNAL",
    date: "2026-04-30",
    number: "JRN-0001",
    narration: "April salary booked, payable on the 7th",
    lines: [
      { dr: "Salary", amount: 96_000 },
      { cr: "Salary Payable", amount: 96_000 },
    ],
  },
  {
    type: "SALES",
    date: "2026-05-06",
    number: "SAL-0002",
    party: "Meera Fashion House",
    narration: "Garment supply - invoice MF/77",
    lines: [
      { dr: "Meera Fashion House", amount: 1_34_400 },
      { cr: "Sales - Garments", amount: 1_20_000 },
      { cr: "Output CGST", amount: 7_200 },
      { cr: "Output SGST", amount: 7_200 },
    ],
    inventory: [{ item: "Stitched Shirt", qty: 200, rate: 600 }],
  },
  {
    type: "SALES",
    date: "2026-05-14",
    number: "SAL-0003",
    party: "Nakoda Garments",
    narration: "Fabric supply - invoice NG/31",
    lines: [
      { dr: "Nakoda Garments", amount: 1_31_250 },
      { cr: "Sales - Fabric", amount: 1_25_000 },
      { cr: "Output CGST", amount: 3_125 },
      { cr: "Output SGST", amount: 3_125 },
    ],
    inventory: [{ item: "Linen Fabric 58in", qty: 250, rate: 500 }],
  },
  {
    type: "PURCHASE",
    date: "2026-05-18",
    number: "PUR-0002",
    party: "Krishna Yarn Traders",
    narration: "Yarn purchase - bill KY/455",
    lines: [
      { dr: "Purchase - Fabric", amount: 1_20_000 },
      { dr: "Input CGST", amount: 3_000 },
      { dr: "Input SGST", amount: 3_000 },
      { cr: "Krishna Yarn Traders", amount: 1_26_000 },
    ],
    inventory: [{ item: "Cotton Fabric 44in", qty: 1_400, rate: 85.71 }],
  },
  {
    type: "CONTRA",
    date: "2026-05-02",
    number: "CON-0001",
    narration: "Cash withdrawn from bank for shop expenses",
    lines: [
      { dr: "Cash", amount: 25_000 },
      { cr: "HDFC Bank - Current A/c", amount: 25_000 },
    ],
  },
  {
    type: "PAYMENT",
    date: "2026-05-05",
    number: "PAY-0002",
    narration: "Shop rent for May",
    lines: [
      { dr: "Rent", amount: 28_000 },
      { cr: "HDFC Bank - Current A/c", amount: 28_000 },
    ],
  },
  {
    type: "PAYMENT",
    date: "2026-05-31",
    number: "PAY-0003",
    narration: "April salary paid",
    lines: [
      { dr: "Salary Payable", amount: 96_000 },
      { cr: "HDFC Bank - Current A/c", amount: 96_000 },
    ],
  },
  {
    type: "SALES",
    date: "2026-06-08",
    number: "SAL-0004",
    party: "Shreeji Boutique",
    narration: "Fabric supply - invoice SB/12",
    lines: [
      { dr: "Shreeji Boutique", amount: 4_03_200 },
      { cr: "Sales - Fabric", amount: 3_84_000 },
      { cr: "Output CGST", amount: 9_600 },
      { cr: "Output SGST", amount: 9_600 },
    ],
    inventory: [{ item: "Cotton Fabric 44in", qty: 3_200, rate: 120 }],
  },
  {
    type: "RECEIPT",
    date: "2026-06-18",
    number: "RCP-0002",
    party: "Ravi Textiles",
    narration: "Receipt against RT/104",
    lines: [
      { dr: "HDFC Bank - Current A/c", amount: 1_26_000 },
      { cr: "Ravi Textiles", amount: 1_26_000 },
    ],
  },
  {
    type: "PAYMENT",
    date: "2026-06-20",
    number: "PAY-0004",
    party: "Dye Master Processors",
    narration: "Processing charges paid",
    lines: [
      { dr: "Dye Master Processors", amount: 54_000 },
      { cr: "HDFC Bank - Current A/c", amount: 54_000 },
    ],
  },
  {
    type: "PAYMENT",
    date: "2026-06-20",
    number: "PAY-0005",
    narration: "GST for April paid in cash",
    lines: [
      { dr: "Output CGST", amount: 4_600 },
      { dr: "Output SGST", amount: 4_600 },
      { cr: "HDFC Bank - Current A/c", amount: 9_200 },
    ],
  },
  {
    type: "JOURNAL",
    date: "2026-06-30",
    number: "JRN-0002",
    narration: "Freight inward billed by transporter",
    lines: [
      { dr: "Freight Inward", amount: 18_500 },
      { cr: "Riddhi Transport", amount: 18_500 },
    ],
  },
  {
    type: "PAYMENT",
    date: "2026-06-30",
    number: "PAY-0006",
    narration: "Monthly telephone and internet",
    lines: [
      { dr: "Telephone & Internet", amount: 4_200 },
      { cr: "Cash", amount: 4_200 },
    ],
  },
  {
    type: "SALES",
    date: "2026-07-04",
    number: "SAL-0005",
    party: "Ravi Textiles",
    narration: "Repeat order - invoice RT/119",
    lines: [
      { dr: "Ravi Textiles", amount: 3_15_000 },
      { cr: "Sales - Fabric", amount: 3_00_000 },
      { cr: "Output CGST", amount: 7_500 },
      { cr: "Output SGST", amount: 7_500 },
    ],
    inventory: [{ item: "Linen Fabric 58in", qty: 600, rate: 500 }],
  },
  {
    type: "CREDIT_NOTE",
    date: "2026-07-10",
    number: "CRN-0001",
    party: "Nakoda Garments",
    narration: "Shade mismatch return against NG/31",
    lines: [
      { cr: "Nakoda Garments", amount: 10_500 },
      { dr: "Sales Returns", amount: 10_000 },
      { dr: "Output CGST", amount: 250 },
      { dr: "Output SGST", amount: 250 },
    ],
  },
  {
    type: "RECEIPT",
    date: "2026-07-15",
    number: "RCP-0003",
    party: "Nakoda Garments",
    narration: "Balance received in cash",
    lines: [
      { dr: "Cash", amount: 94_500 },
      { cr: "Nakoda Garments", amount: 94_500 },
    ],
  },
  {
    type: "PAYMENT",
    date: "2026-07-20",
    number: "PAY-0007",
    narration: "Electricity bill (April to June)",
    lines: [
      { dr: "Electricity", amount: 32_400 },
      { cr: "HDFC Bank - Current A/c", amount: 32_400 },
    ],
  },
  {
    type: "PAYMENT",
    date: "2026-07-31",
    number: "PAY-0008",
    narration: "Bank charges for the quarter",
    lines: [
      { dr: "Bank Charges", amount: 1_250 },
      { cr: "HDFC Bank - Current A/c", amount: 1_250 },
    ],
  },
  {
    type: "PURCHASE",
    date: "2026-08-02",
    number: "PUR-0003",
    party: "Surat Weaving Mills",
    narration: "Grey fabric purchase - bill SWM/2140",
    lines: [
      { dr: "Purchase - Fabric", amount: 1_80_000 },
      { dr: "Input CGST", amount: 4_500 },
      { dr: "Input SGST", amount: 4_500 },
      { cr: "Surat Weaving Mills", amount: 1_89_000 },
    ],
    inventory: [{ item: "Cotton Fabric 44in", qty: 2_100, rate: 85.71 }],
  },
  {
    type: "PURCHASE",
    date: "2026-08-05",
    number: "PUR-0004",
    party: "Surat Weaving Mills",
    narration: "Readymade shirt purchase - bill SWM/2177",
    lines: [
      { dr: "Purchase - Garments", amount: 1_14_000 },
      { dr: "Input CGST", amount: 6_840 },
      { dr: "Input SGST", amount: 6_840 },
      { cr: "Surat Weaving Mills", amount: 1_27_680 },
    ],
    inventory: [{ item: "Stitched Shirt", qty: 300, rate: 380 }],
  },
  {
    type: "SALES",
    date: "2026-08-11",
    number: "SAL-0006",
    party: "Meera Fashion House",
    narration: "Festive season supply - MF/96",
    lines: [
      { dr: "Meera Fashion House", amount: 3_36_000 },
      { cr: "Sales - Garments", amount: 3_00_000 },
      { cr: "Output CGST", amount: 18_000 },
      { cr: "Output SGST", amount: 18_000 },
    ],
    inventory: [{ item: "Stitched Shirt", qty: 500, rate: 600 }],
  },
  {
    type: "RECEIPT",
    date: "2026-08-22",
    number: "RCP-0004",
    party: "Shreeji Boutique",
    narration: "Advance received for October shipment",
    lines: [
      { dr: "HDFC Bank - Current A/c", amount: 60_000 },
      { cr: "Shreeji Boutique", amount: 60_000 },
    ],
  },
  {
    type: "PAYMENT",
    date: "2026-08-28",
    number: "PAY-0009",
    party: "Krishna Yarn Traders",
    narration: "Cleared KY/455",
    lines: [
      { dr: "Krishna Yarn Traders", amount: 1_26_000 },
      { cr: "HDFC Bank - Current A/c", amount: 1_26_000 },
    ],
  },
  {
    type: "PAYMENT",
    date: "2026-08-31",
    number: "PAY-0010",
    narration: "Printing and stationery for the season",
    lines: [
      { dr: "Printing & Stationery", amount: 7_800 },
      { cr: "Cash", amount: 7_800 },
    ],
  },
  {
    type: "SALES",
    date: "2026-09-05",
    number: "SAL-0007",
    party: "Nakoda Garments",
    narration: "Fabric supply - NG/58",
    lines: [
      { dr: "Nakoda Garments", amount: 1_00_800 },
      { cr: "Sales - Fabric", amount: 96_000 },
      { cr: "Output CGST", amount: 2_400 },
      { cr: "Output SGST", amount: 2_400 },
    ],
    inventory: [{ item: "Cotton Fabric 44in", qty: 800, rate: 120 }],
  },
  {
    type: "PAYMENT",
    date: "2026-09-12",
    number: "PAY-0011",
    narration: "GST for May to July paid (input credit carried forward)",
    lines: [
      { dr: "Output CGST", amount: 27_175 },
      { dr: "Output SGST", amount: 27_175 },
      { cr: "HDFC Bank - Current A/c", amount: 54_350 },
    ],
  },
  {
    type: "PAYMENT",
    date: "2026-09-30",
    number: "PAY-0012",
    narration: "September rent and salary",
    lines: [
      { dr: "Rent", amount: 28_000 },
      { dr: "Salary", amount: 1_02_000 },
      { cr: "HDFC Bank - Current A/c", amount: 1_30_000 },
    ],
  },
  {
    type: "RECEIPT",
    date: "2026-10-07",
    number: "RCP-0005",
    party: "Ravi Textiles",
    narration: "Receipt against RT/119",
    lines: [
      { dr: "HDFC Bank - Current A/c", amount: 1_00_000 },
      { cr: "Ravi Textiles", amount: 1_00_000 },
    ],
  },
  {
    type: "JOURNAL",
    date: "2026-10-15",
    number: "JRN-0003",
    narration: "Interest received on fixed deposit",
    lines: [
      { dr: "HDFC Bank - Current A/c", amount: 9_600 },
      { cr: "Interest Received", amount: 9_600 },
    ],
  },
  {
    type: "SALES",
    date: "2026-10-10",
    number: "SAL-0008",
    party: "Ravi Textiles",
    narration: "Diwali stock supply - invoice RT/131",
    lines: [
      { dr: "Ravi Textiles", amount: 1_26_000 },
      { cr: "Sales - Fabric", amount: 1_20_000 },
      { cr: "Output CGST", amount: 3_000 },
      { cr: "Output SGST", amount: 3_000 },
    ],
    inventory: [{ item: "Cotton Fabric 44in", qty: 1_000, rate: 120 }],
  },
  {
    type: "JOURNAL",
    date: "2026-10-20",
    number: "JRN-0004",
    narration: "Half-yearly depreciation on plant and furniture",
    lines: [
      { dr: "Depreciation", amount: 67_500 },
      { cr: "Plant & Machinery", amount: 60_000 },
      { cr: "Furniture & Fixtures", amount: 7_500 },
    ],
  },
];

export const SEED_META = {
  ledgers: LEDGERS,
  stockItems: STOCK_ITEMS,
  vouchers: VOUCHERS,
};

/** Populate an empty database. Safe to call when data already exists. */
export function seed(app) {
  let company;
  try {
    company = app.getCompany();
  } catch {
    company = app.createCompany({
      name: "Surat Weaves Pvt Ltd",
      mailingName: "Surat Weaves Pvt Ltd",
      address: "14, Ring Road, Textile Market, Surat 395002, Gujarat",
      gstin: "24AABCS4321P1Z9",
      state: "Gujarat",
      financialYearStart: "2026-04-01",
      financialYearEnd: "2027-03-31",
    });
  }
  if (app.listLedgers().length > 0) {
    return { company, created: false };
  }

  for (const ledger of LEDGERS) {
    app.createLedger({
      name: ledger.name,
      group: ledger.group,
      opening: ledger.opening,
      openingType: ledger.type,
      gstin: ledger.gstin ?? null,
      creditDays:
        ledger.group === "Sundry Debtors"
          ? 30
          : ledger.group === "Sundry Creditors"
            ? 45
            : null,
    });
  }

  const insertItem = app.db.prepare(
    `INSERT INTO stock_items (name, stock_group, unit, opening_qty_milli, opening_value_paise, gst_rate, hsn)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of STOCK_ITEMS) {
    insertItem.run(
      item.name,
      item.stockGroup,
      item.unit,
      Math.round(item.openingQty * 1000),
      Math.round(item.openingValue * 100),
      item.gstRate,
      item.hsn,
    );
  }
  const insertStockGroup = app.db.prepare(
    "INSERT OR IGNORE INTO stock_groups (name) VALUES (?)",
  );
  for (const item of STOCK_ITEMS) insertStockGroup.run(item.stockGroup);

  for (const voucher of VOUCHERS) {
    const lines = (voucher.lines ?? []).map((line) =>
      line.dr !== undefined
        ? { ledger: line.dr, debit: line.amount }
        : { ledger: line.cr, credit: line.amount },
    );
    app.createVoucher({
      type: voucher.type,
      date: voucher.date,
      number: voucher.number,
      narration: voucher.narration,
      partyLedgerId: voucher.party === undefined ? undefined : voucher.party,
      lines,
      inventory: voucher.inventory,
    });
  }

  return { company, created: true };
}
