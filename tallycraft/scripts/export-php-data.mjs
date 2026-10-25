/**
 * Export the PHP backend's data from the Node source of truth.
 *
 * Two artefacts, both generated, never hand-edited:
 *
 *   api-php/data/catalog.json  the chart of accounts and voucher types
 *   api-php/data/seed.json     the demo book, exactly as Node seeds it
 *
 * The alternative — retyping the catalog and the demo book in PHP — guarantees
 * drift: a group renamed in one place, a voucher dated differently, and the two
 * backends quietly disagree about the same company. Generating them means the
 * parity test is comparing the code, not the data.
 *
 * Usage: node scripts/export-php-data.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TallyCraft } from "../src/app.js";
import {
  GST_RATES,
  GROUPS,
  PRIMARY_GROUP_NAMES,
  UNITS,
  VOUCHER_TYPES,
  profitLossSectionFor,
} from "../src/catalog.js";
import { seed } from "../src/seed.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(projectRoot, "api-php", "data");

/** Group metadata plus the two derived lookups PHP needs at runtime. */
export function buildCatalog() {
  return {
    groups: GROUPS.map((group) => ({
      name: group.name,
      parent: group.parent,
      nature: group.nature,
      natural: group.natural,
      statement: group.nature === "income" || group.nature === "expense"
        ? "profit_loss"
        : "balance_sheet",
      section: profitLossSectionFor(group.name),
    })),
    primaryGroups: PRIMARY_GROUP_NAMES,
    voucherTypes: VOUCHER_TYPES.map((type) => ({
      code: type.code,
      name: type.name,
      shortcut: type.shortcut,
      prefix: type.prefix,
      group: type.group,
      requires: type.requires ?? null,
    })),
    units: UNITS,
    gstRates: GST_RATES,
  };
}

/**
 * The whole demo book as plain rows, in insert order.
 *
 * Insert order, not report order: PHP replays these in sequence, so ids then
 * land in exactly the same places as the Node book. That keeps `/api/vouchers/7`
 * meaning the same voucher on both backends — which matters for bookmarks,
 * exports and, frankly, for trusting the parity test.
 */
export function buildSeed(app) {
  const company = app.getCompany();
  const ledgers = app.db
    .prepare("SELECT id FROM ledgers ORDER BY id")
    .all()
    .map((row) => app.getLedger(Number(row.id)));
  const vouchers = app.db
    .prepare("SELECT id FROM vouchers ORDER BY id")
    .all()
    .map((row) => Number(row.id));

  // Raw rows: the summary rounds quantities for display, and a seed must not
  // round. Opening value and HSN only exist on the row itself.
  const stockItems = app.db.prepare("SELECT * FROM stock_items ORDER BY id").all();
  const detailed = vouchers.map((id) => {
    const full = app.getVoucher(id);
    return {
      type: full.type,
      number: full.number,
      date: full.date,
      narration: full.narration,
      reference: full.reference,
      party: full.party?.name ?? null,
      total: full.total,
      lines: full.lines.map((line) => ({
        ledger: line.ledger,
        amount: line.amount,
      })),
      inventory: full.inventory.map((row) => ({
        item: row.item,
        // Signed quantities are a report artefact (direction belongs to the
        // voucher type). The seed takes magnitudes, exactly like seed.js.
        quantity: Math.abs(row.quantity),
        rate: row.rate,
        amount: row.amount,
      })),
    };
  });

  return {
    company: {
      name: company.name,
      mailingName: company.mailingName,
      address: company.address,
      gstin: company.gstin,
      state: company.state,
      financialYearStart: company.financialYearStart,
      financialYearEnd: company.financialYearEnd,
      baseCurrency: company.baseCurrency,
    },
    ledgers: ledgers.map((ledger) => ({
      name: ledger.name,
      group: ledger.group,
      opening: ledger.opening,
      openingDated: ledger.openingDated,
      gstin: ledger.gstin,
      partyType: ledger.partyType,
      mailingName: ledger.mailingName,
      address: ledger.address,
      phone: ledger.phone,
      creditDays: ledger.creditDays,
    })),
    stockItems: stockItems.map((item) => ({
      name: item.name,
      group: item.stock_group,
      unit: item.unit,
      gstRate: Number(item.gst_rate),
      openingQtyMilli: Number(item.opening_qty_milli),
      openingValuePaise: Number(item.opening_value_paise),
      hsn: item.hsn,
    })),
    stockGroups: app.db
      .prepare("SELECT name FROM stock_groups ORDER BY name")
      .all()
      .map((row) => row.name),
    vouchers: detailed,
  };
}

async function main() {
  const app = TallyCraft.open(":memory:");
  try {
    seed(app);
    const catalog = buildCatalog();
    const seedData = buildSeed(app);
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, "catalog.json"),
      `${JSON.stringify(catalog, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(outDir, "seed.json"),
      `${JSON.stringify(seedData, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `Wrote ${outDir}/catalog.json (${catalog.groups.length} groups, ${catalog.voucherTypes.length} voucher types)`,
    );
    console.log(
      `Wrote ${outDir}/seed.json (${seedData.ledgers.length} ledgers, ${seedData.vouchers.length} vouchers, ${seedData.stockItems.length} stock items)`,
    );
  } finally {
    app.close();
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
