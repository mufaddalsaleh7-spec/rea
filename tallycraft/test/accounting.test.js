import assert from "node:assert/strict";
import { test } from "node:test";
import { TallyCraft, TallyCraftError } from "../src/app.js";
import { seed } from "../src/seed.js";
import { GROUPS, PRIMARY_GROUP_NAMES, VOUCHER_TYPES } from "../src/catalog.js";
import { formatPaise, parseAmount, toPaise } from "../src/money.js";

function seeded() {
  const app = TallyCraft.open(":memory:");
  seed(app);
  return app;
}

function ledgerBy(app, name) {
  const ledger = app.listLedgers().find((entry) => entry.name === name);
  assert.ok(ledger, `missing ledger ${name}`);
  return ledger;
}

test("catalog mirrors Tally's 28 predefined groups", () => {
  assert.equal(GROUPS.length, 28);
  assert.equal(PRIMARY_GROUP_NAMES.length, 16);
  assert.equal(new Set(GROUPS.map((group) => group.name)).size, 28);
  for (const group of GROUPS) {
    if (group.parent !== null) {
      assert.ok(
        GROUPS.some((candidate) => candidate.name === group.parent),
        `${group.name} has an unknown parent`,
      );
    }
  }
  assert.equal(VOUCHER_TYPES.length, 8);
  assert.equal(new Set(VOUCHER_TYPES.map((type) => type.shortcut)).size, 8);
});

test("money parsing and Indian grouping", () => {
  assert.equal(parseAmount("1,23,456.78"), 12_345_678);
  assert.equal(parseAmount("500"), 50_000);
  assert.equal(parseAmount("-250.5"), -25_050);
  assert.equal(parseAmount("12."), 1_200);
  assert.equal(parseAmount("1.234"), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(formatPaise(12_345_678), "1,23,456.78");
  assert.equal(formatPaise(-50_000), "-500.00");
  assert.equal(formatPaise(0, { blankZero: true }), "");
  assert.equal(toPaise(1234.56), 123_456);
});

test("seed posts a balanced book", () => {
  const app = seeded();
  const statistics = app.statistics();
  assert.equal(statistics.counts.ledgers, 37);
  assert.equal(statistics.counts.vouchers, 35);
  assert.equal(statistics.counts.groups, 28);

  const trialBalance = app.trialBalance({ asOf: "2027-03-31" });
  assert.equal(trialBalance.balanced, true);
  assert.equal(trialBalance.totals.debit, trialBalance.totals.credit);
  assert.equal(trialBalance.difference, 0);
  app.close();
});

test("balance sheet balances and agrees with the P&L", () => {
  const app = seeded();
  for (const asOf of ["2026-04-30", "2026-07-31", "2026-10-24", "2027-03-31"]) {
    const sheet = app.balanceSheet({ asOf });
    assert.equal(sheet.balanced, true, `balance sheet differs on ${asOf}`);
    const profitAndLoss = app.profitLoss({
      from: app.getCompany().financialYearStart,
      to: asOf,
    });
    assert.equal(
      Number(profitAndLoss.netProfit),
      Number(sheet.profitAndLoss.amount) *
        (sheet.profitAndLoss.isLoss ? -1 : 1),
    );
    assert.equal(
      Number(sheet.stock.closing),
      Number(profitAndLoss.stock.closing),
    );
  }
  app.close();
});

test("every voucher is balanced and trial balance holds on any date", () => {
  const app = seeded();
  for (const voucher of app.listVouchers({ limit: 500 })) {
    const detail = app.getVoucher(voucher.id);
    const total = detail.lines.reduce(
      (sum, line) => sum + Math.round(line.amount * 100),
      0,
    );
    assert.equal(total, 0, `${detail.number} is unbalanced`);
    assert.ok(detail.lines.length >= 2);
  }
  for (const asOf of ["2026-04-01", "2026-05-15", "2026-08-31", "2026-12-31"]) {
    const trialBalance = app.trialBalance({ asOf });
    assert.equal(trialBalance.balanced, true, `unbalanced as on ${asOf}`);
  }
  app.close();
});

test("voucher creation rejects invalid input", () => {
  const app = seeded();
  const date = "2026-10-21";

  assert.throws(
    () =>
      app.createVoucher({
        type: "JOURNAL",
        date,
        lines: [
          { ledger: "Cash", debit: 100 },
          { ledger: "Rent", credit: 90 },
        ],
      }),
    (error) => error instanceof TallyCraftError && error.code === "UNBALANCED",
  );

  assert.throws(
    () =>
      app.createVoucher({
        type: "JOURNAL",
        date,
        lines: [{ ledger: "Cash", debit: 100 }],
      }),
    (error) => error.code === "TOO_FEW_LINES",
  );

  assert.throws(
    () =>
      app.createVoucher({
        type: "JOURNAL",
        date: "2027-05-01",
        lines: [
          { ledger: "Cash", debit: 10 },
          { ledger: "Rent", credit: 10 },
        ],
      }),
    (error) => error.code === "OUTSIDE_FINANCIAL_YEAR",
  );

  assert.throws(
    () =>
      app.createVoucher({
        type: "JOURNAL",
        date,
        lines: [
          { ledger: "Stock-in-Hand", debit: 10 },
          { ledger: "Rent", credit: 10 },
        ],
      }),
    (error) => error.code === "RESERVED_GROUP",
  );

  assert.throws(
    () =>
      app.createVoucher({
        type: "JOURNAL",
        date,
        lines: [
          { ledger: "Cash", debit: 10 },
          { ledger: "No Such Ledger", credit: 10 },
        ],
      }),
    (error) => error.code === "UNKNOWN_LEDGER",
  );

  assert.throws(
    () => app.createVoucher({ type: "SALES-ORDER", date, lines: [] }),
    (error) => error.code === "UNKNOWN_VOUCHER_TYPE",
  );
  app.close();
});

test("voucher numbering is sequential per type and financial year", () => {
  const app = seeded();
  assert.equal(app.currentVoucherNumber("SALES", "2026-10-24"), "SAL-0009");
  const result = app.createVoucher({
    type: "SALES",
    date: "2026-10-22",
    narration: "Counter sale",
    lines: [
      { ledger: "Nakoda Garments", debit: 52_500 },
      { ledger: "Sales - Fabric", credit: 50_000 },
      { ledger: "Output CGST", credit: 1_250 },
      { ledger: "Output SGST", credit: 1_250 },
    ],
  });
  assert.equal(result.voucher.number, "SAL-0009");
  assert.equal(app.currentVoucherNumber("SALES", "2026-10-24"), "SAL-0010");
  assert.throws(
    () =>
      app.createVoucher({
        type: "SALES",
        date: "2026-10-22",
        number: "SAL-0009",
        lines: [
          { ledger: "Nakoda Garments", debit: 10 },
          { ledger: "Sales - Fabric", credit: 10 },
        ],
      }),
    (error) => error.code === "DUPLICATE_VOUCHER",
  );
  app.close();
});

test("unusual voucher shapes warn without blocking", () => {
  const app = seeded();
  const result = app.createVoucher({
    type: "SALES",
    date: "2026-10-23",
    lines: [
      { ledger: "Cash", debit: 1_000 },
      { ledger: "Salary", credit: 1_000 },
    ],
  });
  assert.equal(result.warnings.length > 0, true);
  assert.ok(
    result.warnings.some((warning) => warning.code === "UNUSUAL_LEDGER_GROUP"),
  );
  app.close();
});

test("ledger statement reconciles opening, movement and closing", () => {
  const app = seeded();
  const bank = ledgerBy(app, "HDFC Bank - Current A/c");
  const report = app.ledgerReport({
    ledgerId: bank.id,
    from: "2026-04-01",
    to: "2026-10-24",
  });
  assert.equal(report.opening, 850_000);
  assert.equal(report.closing, 569_400);
  assert.equal(report.closingType, "Dr");
  assert.equal(report.entries.length, 16);

  const debits = report.entries.reduce(
    (sum, entry) => sum + Math.round(entry.debit * 100),
    0,
  );
  const credits = report.entries.reduce(
    (sum, entry) => sum + Math.round(entry.credit * 100),
    0,
  );
  assert.equal(report.opening * 100 + debits - credits, report.closing * 100);

  const june = app.ledgerReport({
    ledgerId: bank.id,
    from: "2026-06-01",
    to: "2026-06-30",
  });
  assert.equal(june.entries.length, 3);
  app.close();
});

test("day book totals equal and filter by type", () => {
  const app = seeded();
  const day = app.dayBook({ date: "2026-09-30" });
  assert.equal(day.count, 1);
  assert.equal(day.totals.debit, day.totals.credit);
  assert.equal(day.totals.debit, 130_000);

  const gst = app.dayBook({ date: "2026-09-12" });
  assert.equal(gst.vouchers[0].type, "PAYMENT");
  app.close();
});

test("outstanding receivables agree with the debtors statistic", () => {
  const app = seeded();
  const stats = app.statistics();
  const report = app.outstanding({ asOf: "2027-03-31", type: "receivable" });
  assert.equal(Number(report.total), Number(stats.debtors));
  const buckets = Object.values(report.ageing).reduce(
    (sum, value) => sum + Number(value),
    0,
  );
  assert.equal(
    Math.round(buckets * 100),
    Math.round(Number(report.total) * 100),
  );
  app.close();
});

test("stock summary quantity and value drive closing stock", () => {
  const app = seeded();
  const stock = app.stockSummary({ asOf: "2026-10-24" });
  const sheet = app.balanceSheet({ asOf: "2026-10-24" });
  assert.equal(stock.totalValue, sheet.stock.closing);
  for (const row of stock.rows) {
    assert.ok(row.closingQty >= 0, `${row.name} went negative`);
    assert.equal(
      Math.round((row.openingQty + row.inwardQty - row.outwardQty) * 1000),
      Math.round(row.closingQty * 1000),
    );
  }

  assert.throws(
    () =>
      app.createVoucher({
        type: "JOURNAL",
        date: "2026-10-24",
        inventory: [{ item: "Cotton Fabric 44in", qty: 5, rate: 100 }],
        lines: [
          { ledger: "Cash", debit: 10 },
          { ledger: "Rent", credit: 10 },
        ],
      }),
    (error) => error.code === "INVENTORY_ON_ACCOUNTING_VOUCHER",
  );
  app.close();
});

test("profit and loss sections split trading from indirect", () => {
  const app = seeded();
  const report = app.profitLoss({ from: "2026-04-01", to: "2026-10-24" });
  assert.equal(report.directIncome.rows[0].name, "Sales Accounts");
  assert.equal(
    report.directExpense.rows.some((row) => row.name === "Opening Stock"),
    true,
  );
  assert.equal(
    report.directIncome.rows.some((row) => row.name === "Closing Stock"),
    true,
  );
  assert.equal(Number(report.grossProfit), 645_457);
  assert.equal(Number(report.netProfit), 287_907);
  assert.equal(report.isLoss, false);
  const totalIndirect =
    Number(report.indirectIncome.total) - Number(report.indirectExpense.total);
  assert.equal(
    Math.round((Number(report.grossProfit) + totalIndirect) * 100),
    Math.round(Number(report.netProfit) * 100),
  );
  app.close();
});

test("Tally XML round-trips masters and vouchers", () => {
  const app = seeded();
  const xml = app.exportXml();
  assert.match(xml, /<ENVELOPE>/);
  assert.match(xml, /ISDEEMEDPOSITIVE>Yes/);
  assert.match(xml, /<VOUCHER VCHTYPE="Sales"/);

  const clone = TallyCraft.open(":memory:");
  clone.createCompany({
    name: "Surat Weaves Pvt Ltd",
    financialYearStart: "2026-04-01",
    financialYearEnd: "2027-03-31",
  });
  const summary = clone.importXml(xml);
  assert.equal(summary.ledgers, 37);
  assert.equal(summary.vouchers, 35);
  assert.equal(summary.skipped, 0);

  const original = app.trialBalance({ asOf: "2027-03-31" });
  const imported = clone.trialBalance({ asOf: "2027-03-31" });
  assert.deepEqual(imported.totals, original.totals);
  assert.equal(imported.balanced, true);
  assert.equal(clone.balanceSheet({ asOf: "2026-10-24" }).balanced, true);
  app.close();
  clone.close();
});

test("import dry run leaves the book untouched", () => {
  const app = seeded();
  const xml = app.exportXml({ masters: true, vouchers: true });
  const empty = TallyCraft.open(":memory:");
  empty.createCompany({
    name: "Import Target",
    financialYearStart: "2026-04-01",
    financialYearEnd: "2027-03-31",
  });
  const preview = empty.importXml(xml, { dryRun: true });
  assert.equal(preview.dryRun, true);
  assert.equal(empty.listLedgers().length, 0);
  assert.equal(empty.listVouchers({ limit: 10 }).length, 0);
  app.close();
  empty.close();
});

test("import surfaces malformed envelopes instead of guessing", () => {
  const app = seeded();
  assert.throws(
    () => app.importXml("<ENVELOPE><BODY></ENVELOPE>"),
    (error) => error.code === "INVALID_XML",
  );
  app.close();
});

test("ledger masters enforce unique names and safe deletion", () => {
  const app = seeded();
  assert.throws(
    () => app.createLedger({ name: "cash", group: "Cash-in-Hand" }),
    (error) => error.code === "DUPLICATE_LEDGER",
  );
  const spare = app.createLedger({
    name: "Petty Cash",
    group: "Cash-in-Hand",
    opening: 5_000,
    openingType: "Dr",
  });
  assert.equal(spare.opening, 5_000);
  const cash = ledgerBy(app, "Cash");
  assert.throws(
    () => app.deleteLedger(cash.id),
    (error) => error.code === "LEDGER_IN_USE",
  );
  assert.deepEqual(app.deleteLedger(spare.id), { deleted: spare.id });
  app.close();
});

test("credit openings are stored as credits", () => {
  const app = seeded();
  const capital = ledgerBy(app, "Share Capital");
  assert.equal(capital.opening, -2_439_500);
  assert.equal(ledgerBy(app, "Plant & Machinery").opening, 1_200_000);
  app.close();
});
