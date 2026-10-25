/**
 * TallyCraft application service.
 *
 * Every reported figure is derived from the journal (voucher lines) at read
 * time; nothing is cached, so the trial balance cannot drift from the
 * vouchers that produced it. Signs are the application-wide convention:
 * debit positive, credit negative.
 */

import { openDatabase, all, one, run, transaction } from "./db.js";
import {
  GROUPS_BY_NAME,
  PRIMARY_GROUP_NAMES,
  VOUCHER_TYPES,
  VOUCHER_TYPES_BY_CODE,
  VOUCHER_TYPES_BY_NAME,
  VOUCHER_TYPES_BY_SHORTCUT,
  profitLossSectionFor,
} from "./catalog.js";
import { parseAmount, toPaise, toRupees, formatPaise } from "./money.js";
import {
  childText,
  childrenNamed,
  escapeXml,
  findAll,
  parseXml,
} from "./xml.js";

export class TallyCraftError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "TallyCraftError";
    this.code = code;
    this.details = details;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value, field = "date") {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    throw new TallyCraftError(
      "INVALID_DATE",
      `${field} must be an ISO date (YYYY-MM-DD)`,
    );
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new TallyCraftError("INVALID_DATE", `${field} is not a real date`);
  }
  return value;
}

/** "1,23,456.78" | 1234.5 | "500 Cr" -> signed paise (debit positive). */
function parseSignedAmount(value, direction) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TallyCraftError(
        "INVALID_AMOUNT",
        "Amount must be a finite number",
      );
    }
    return toPaise(value);
  }
  if (typeof value !== "string") {
    throw new TallyCraftError(
      "INVALID_AMOUNT",
      "Amount must be a number or numeric string",
    );
  }
  const trimmed = value.trim();
  const suffix = /\s*(dr|cr)$/i.exec(trimmed);
  let magnitude = suffix === null ? trimmed : trimmed.slice(0, suffix.index);
  if (magnitude.startsWith("=")) magnitude = magnitude.slice(1);
  const parsed = parseAmount(magnitude);
  if (parsed === null) {
    throw new TallyCraftError(
      "INVALID_AMOUNT",
      `Cannot read amount "${value}"`,
    );
  }
  const sign =
    suffix === null
      ? direction
      : suffix[1].toLowerCase() === "dr"
        ? "Dr"
        : "Cr";
  const absolute = Math.abs(parsed);
  if (sign === undefined) return parsed;
  return sign === "Cr" ? -absolute : absolute;
}

/** Apply a Dr/Cr direction to a magnitude expressed in paise. */
function applyDirection(magnitudePaise, direction) {
  return direction === "Cr"
    ? -Math.abs(magnitudePaise)
    : Math.abs(magnitudePaise);
}

/** Signed Tally amount text: debit positive, credit negative. */
function xmlAmount(paise) {
  const absolute = Math.abs(paise);
  const whole = Math.trunc(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${paise < 0 ? "-" : ""}${whole}.${fraction}`;
}

function moneyNumber(paise) {
  return toRupees(paise);
}

function normaliseName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function dateWithOffset(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export class TallyCraft {
  constructor(db) {
    this.db = db;
  }

  static open(filePath) {
    return new TallyCraft(openDatabase(filePath));
  }

  close() {
    this.db.close();
  }

  // ---------------------------------------------------------------- company

  getCompany() {
    const company = one(this.db, "SELECT * FROM companies ORDER BY id LIMIT 1");
    if (company === null) {
      throw new TallyCraftError(
        "NO_COMPANY",
        "No company is loaded. Create one in Masters.",
      );
    }
    return {
      id: Number(company.id),
      name: company.name,
      mailingName: company.mailing_name,
      address: company.address,
      gstin: company.gstin,
      state: company.state,
      financialYearStart: company.financial_year_start,
      financialYearEnd: company.financial_year_end,
      baseCurrency: company.base_currency,
    };
  }

  createCompany(input) {
    const name = normaliseName(input.name);
    if (name === "")
      throw new TallyCraftError("INVALID_NAME", "Company name is required");
    const start = assertIsoDate(
      input.financialYearStart ?? "2026-04-01",
      "financialYearStart",
    );
    const end = assertIsoDate(
      input.financialYearEnd ?? "2027-03-31",
      "financialYearEnd",
    );
    if (end <= start) {
      throw new TallyCraftError(
        "INVALID_DATE_RANGE",
        "Financial year end must follow its start",
      );
    }
    run(
      this.db,
      `INSERT INTO companies
       (name, mailing_name, address, gstin, state, financial_year_start, financial_year_end, base_currency, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?)`,
      name,
      input.mailingName ?? name,
      input.address ?? null,
      input.gstin ?? null,
      input.state ?? null,
      start,
      end,
      new Date().toISOString(),
    );
    return this.getCompany();
  }

  // ----------------------------------------------------------------- groups

  groupTree() {
    const rows = all(this.db, "SELECT * FROM groups");
    const byName = new Map();
    for (const row of rows) {
      byName.set(row.name, {
        id: Number(row.id),
        name: row.name,
        parent: row.parent,
        nature: row.nature,
        natural: row.natural,
        predefined: Number(row.predefined) === 1,
        children: [],
        groups: [],
        ledgers: [],
      });
    }
    for (const node of byName.values()) {
      if (node.parent !== null) byName.get(node.parent)?.groups.push(node);
    }
    const catalogOrder = (name) => {
      const index = PRIMARY_GROUP_NAMES.indexOf(name);
      return index === -1 ? 999 : index;
    };
    const roots = [...byName.values()]
      .filter((node) => node.parent === null)
      .sort((a, b) => catalogOrder(a.name) - catalogOrder(b.name));
    return { byName, roots };
  }

  listGroups() {
    return all(
      this.db,
      `SELECT g.name, g.parent, g.nature, g.natural,
              (SELECT COUNT(*) FROM ledgers l WHERE l.group_id = g.id) AS ledger_count
       FROM groups g
       ORDER BY g.nature, g.parent IS NOT NULL, g.name`,
    ).map((row) => ({ ...row, ledger_count: Number(row.ledger_count) }));
  }

  // ---------------------------------------------------------------- ledgers

  ledgerRows() {
    return all(
      this.db,
      `SELECT l.*, g.name AS group_name, g.nature, g.natural
       FROM ledgers l JOIN groups g ON g.id = l.group_id
       ORDER BY g.name, l.name COLLATE NOCASE`,
    ).map((row) => this.#mapLedger(row));
  }

  #mapLedger(row) {
    return {
      id: Number(row.id),
      name: row.name,
      group: row.group_name,
      groupId: Number(row.group_id),
      nature: row.nature,
      natural: row.natural,
      opening: moneyNumber(Number(row.opening_paise)),
      openingPaise: Number(row.opening_paise),
      openingDated: row.opening_dated,
      gstin: row.gstin,
      partyType: row.party_type,
      mailingName: row.mailing_name,
      address: row.address,
      phone: row.phone,
      creditDays: row.credit_days,
      isActive: Number(row.is_active) === 1,
    };
  }

  listLedgers({ group = null, search = null } = {}) {
    const rows = this.ledgerRows();
    const query = search === null ? null : search.trim().toLowerCase();
    return rows
      .filter((ledger) => group === null || ledger.group === group)
      .filter(
        (ledger) =>
          query === null ||
          query === "" ||
          ledger.name.toLowerCase().includes(query),
      );
  }

  getLedger(id) {
    const row = one(
      this.db,
      `SELECT l.*, g.name AS group_name, g.nature, g.natural
       FROM ledgers l JOIN groups g ON g.id = l.group_id WHERE l.id = ?`,
      id,
    );
    if (row === null)
      throw new TallyCraftError("UNKNOWN_LEDGER", `No ledger with id ${id}`);
    return this.#mapLedger(row);
  }

  #resolveGroup(name) {
    const normalised = normaliseName(name);
    const group = one(
      this.db,
      "SELECT * FROM groups WHERE name = ? COLLATE NOCASE",
      normalised,
    );
    if (group === null) {
      throw new TallyCraftError("UNKNOWN_GROUP", `No group named "${name}"`, {
        groups: PRIMARY_GROUP_NAMES,
      });
    }
    return group;
  }

  createLedger(input) {
    const name = normaliseName(input.name);
    if (name === "")
      throw new TallyCraftError("INVALID_NAME", "Ledger name is required");
    const group = this.#resolveGroup(input.group);
    const existing = one(
      this.db,
      "SELECT id FROM ledgers WHERE name = ? COLLATE NOCASE",
      name,
    );
    if (existing !== null) {
      throw new TallyCraftError(
        "DUPLICATE_LEDGER",
        `Ledger "${name}" already exists`,
        {
          id: Number(existing.id),
        },
      );
    }
    const openingPaise =
      input.opening === undefined ||
      input.opening === null ||
      input.opening === ""
        ? 0
        : applyDirection(
            Math.abs(parseSignedAmount(input.opening, undefined)),
            input.openingType ?? group.natural,
          );
    const partyType =
      input.partyType ??
      (group.name === "Sundry Debtors"
        ? "debtor"
        : group.name === "Sundry Creditors"
          ? "creditor"
          : null);
    const result = run(
      this.db,
      `INSERT INTO ledgers
       (name, group_id, opening_paise, opening_dated, gstin, party_type,
        mailing_name, address, phone, credit_days, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      name,
      group.id,
      openingPaise,
      input.openingDated ?? null,
      input.gstin ?? null,
      partyType,
      input.mailingName ?? name,
      input.address ?? null,
      input.phone ?? null,
      input.creditDays ?? null,
      new Date().toISOString(),
    );
    return this.getLedger(Number(result.lastInsertRowid));
  }

  updateLedger(id, patch) {
    const existing = this.getLedger(id);
    const group =
      patch.group === undefined ? null : this.#resolveGroup(patch.group);
    const name =
      patch.name === undefined ? existing.name : normaliseName(patch.name);
    if (name === "")
      throw new TallyCraftError("INVALID_NAME", "Ledger name is required");
    const clash = one(
      this.db,
      "SELECT id FROM ledgers WHERE name = ? COLLATE NOCASE AND id <> ?",
      name,
      id,
    );
    if (clash !== null)
      throw new TallyCraftError("DUPLICATE_LEDGER", `Ledger "${name}" exists`);
    run(
      this.db,
      `UPDATE ledgers SET name = ?, group_id = ?, opening_paise = ?, gstin = ?, party_type = ?,
         mailing_name = ?, address = ?, phone = ?, credit_days = ? WHERE id = ?`,
      name,
      group?.id ?? existing.groupId,
      patch.opening === undefined
        ? existing.openingPaise
        : applyDirection(
            Math.abs(parseSignedAmount(patch.opening, undefined)),
            patch.openingType ?? existing.natural,
          ),
      patch.gstin ?? existing.gstin,
      patch.partyType ?? existing.partyType,
      patch.mailingName ?? existing.mailingName,
      patch.address ?? existing.address,
      patch.phone ?? existing.phone,
      patch.creditDays ?? existing.creditDays,
      id,
    );
    return this.getLedger(id);
  }

  deleteLedger(id) {
    const ledger = this.getLedger(id);
    const used = one(
      this.db,
      "SELECT COUNT(*) AS n FROM voucher_lines WHERE ledger_id = ?",
      id,
    );
    if (Number(used.n) > 0) {
      throw new TallyCraftError(
        "LEDGER_IN_USE",
        `"${ledger.name}" is used by ${used.n} voucher line(s); delete those vouchers first`,
      );
    }
    run(this.db, "DELETE FROM ledgers WHERE id = ?", id);
    return { deleted: id };
  }

  // --------------------------------------------------------------- vouchers

  currentVoucherNumber(type, date) {
    const company = this.getCompany();
    const definition = VOUCHER_TYPES_BY_CODE.get(type);
    if (definition === undefined)
      throw new TallyCraftError("UNKNOWN_VOUCHER_TYPE", type);
    const rows = all(
      this.db,
      "SELECT number FROM vouchers WHERE type = ? AND date BETWEEN ? AND ?",
      type,
      company.financialYearStart,
      company.financialYearEnd,
    );
    const pattern = new RegExp(`^${definition.prefix}-(\\d+)$`);
    let highest = 0;
    for (const row of rows) {
      const match = pattern.exec(row.number);
      if (match !== null) highest = Math.max(highest, Number(match[1]));
    }
    return `${definition.prefix}-${String(highest + 1).padStart(4, "0")}`;
  }

  #findLedger(identifier) {
    if (typeof identifier === "number") return this.getLedger(identifier);
    if (typeof identifier === "string") {
      const row = one(
        this.db,
        `SELECT l.*, g.name AS group_name, g.nature, g.natural
         FROM ledgers l JOIN groups g ON g.id = l.group_id WHERE l.name = ? COLLATE NOCASE`,
        identifier.trim(),
      );
      if (row !== null) return this.#mapLedger(row);
    }
    throw new TallyCraftError(
      "UNKNOWN_LEDGER",
      `No ledger matching ${JSON.stringify(identifier)}`,
    );
  }

  #normaliseLines(lines) {
    if (!Array.isArray(lines) || lines.length < 2) {
      throw new TallyCraftError(
        "TOO_FEW_LINES",
        "A voucher needs at least two ledger entries",
      );
    }
    return lines.map((line, index) => {
      const ledger = this.#findLedger(
        line.ledgerId ?? line.ledger ?? line.ledgerName,
      );
      if (ledger.group === "Stock-in-Hand") {
        throw new TallyCraftError(
          "RESERVED_GROUP",
          `"${ledger.name}" belongs to Stock-in-Hand, which is owned by the inventory reports`,
        );
      }
      let paise;
      if (line.debit !== undefined)
        paise = Math.abs(parseSignedAmount(line.debit, "Dr"));
      else if (line.credit !== undefined)
        paise = -Math.abs(parseSignedAmount(line.credit, "Cr"));
      else if (line.amount !== undefined)
        paise = parseSignedAmount(line.amount, line.type ?? "Dr");
      else
        throw new TallyCraftError(
          "INVALID_AMOUNT",
          `Line ${index + 1} has no amount`,
        );
      if (paise === 0) {
        throw new TallyCraftError(
          "INVALID_AMOUNT",
          `Line ${index + 1} has a zero amount`,
        );
      }
      return {
        ledgerId: ledger.id,
        ledgerName: ledger.name,
        group: ledger.group,
        amountPaise: paise,
        billRef: line.billRef ?? null,
        position: index,
      };
    });
  }

  #voucherWarnings(type, lines) {
    const definition = VOUCHER_TYPES_BY_CODE.get(type);
    const warnings = [];
    if (definition?.requires) {
      const groups = new Set(lines.map((line) => line.group));
      if (!definition.requires.anyOf.some((group) => groups.has(group))) {
        warnings.push({
          code: "UNUSUAL_LEDGER_GROUP",
          message: definition.requires.hint,
        });
      }
    }
    const debits = lines.filter((line) => line.amountPaise > 0).length;
    const credits = lines.filter((line) => line.amountPaise < 0).length;
    if (debits === 0 || credits === 0) {
      warnings.push({
        code: "ONE_SIDED",
        message: "Every voucher should carry at least one debit and one credit",
      });
    }
    return warnings;
  }

  createVoucher(input) {
    const company = this.getCompany();
    const type = this.#resolveVoucherType(input.type);
    const date = assertIsoDate(
      input.date ?? new Date().toISOString().slice(0, 10),
    );
    if (date < company.financialYearStart || date > company.financialYearEnd) {
      throw new TallyCraftError(
        "OUTSIDE_FINANCIAL_YEAR",
        `${date} is outside ${company.financialYearStart}..${company.financialYearEnd}`,
      );
    }
    const lines = this.#normaliseLines(input.lines);
    const total = lines.reduce((sum, line) => sum + line.amountPaise, 0);
    if (total !== 0) {
      throw new TallyCraftError("UNBALANCED", "Debits and credits must agree", {
        differencePaise: total,
        difference: formatPaise(Math.abs(total)),
      });
    }
    const number =
      normaliseName(input.number ?? "") ||
      this.currentVoucherNumber(type, date);
    const exists = one(
      this.db,
      "SELECT id FROM vouchers WHERE type = ? AND number = ?",
      type,
      number,
    );
    if (exists !== null) {
      throw new TallyCraftError(
        "DUPLICATE_VOUCHER",
        `Voucher ${number} already exists`,
        {
          next: this.currentVoucherNumber(type, date),
        },
      );
    }
    const party =
      input.partyLedgerId !== undefined && input.partyLedgerId !== null
        ? this.#findLedger(input.partyLedgerId)
        : this.#inferParty(type, lines);
    const grossPaise = lines
      .filter((line) => line.amountPaise > 0)
      .reduce((sum, line) => sum + line.amountPaise, 0);
    const warnings = this.#voucherWarnings(type, lines);
    const now = new Date().toISOString();

    const id = transaction(this.db, () => {
      const result = run(
        this.db,
        `INSERT INTO vouchers (type, number, date, narration, reference, party_ledger_id, total_paise, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        type,
        number,
        date,
        input.narration ?? null,
        input.reference ?? null,
        party?.id ?? null,
        grossPaise,
        now,
        now,
      );
      const voucherId = Number(result.lastInsertRowid);
      const insertLine = this.db.prepare(
        "INSERT INTO voucher_lines (voucher_id, ledger_id, amount_paise, bill_ref, position) VALUES (?, ?, ?, ?, ?)",
      );
      for (const line of lines) {
        insertLine.run(
          voucherId,
          line.ledgerId,
          line.amountPaise,
          line.billRef,
          line.position,
        );
      }
      this.#insertInventory(voucherId, type, input.inventory);
      return voucherId;
    });
    return { voucher: this.getVoucher(id), warnings };
  }

  #inferParty(type, lines) {
    const preferredGroup =
      type === "SALES" || type === "CREDIT_NOTE"
        ? "Sundry Debtors"
        : type === "PURCHASE" || type === "DEBIT_NOTE"
          ? "Sundry Creditors"
          : null;
    if (preferredGroup === null) return null;
    const line = lines.find((candidate) => candidate.group === preferredGroup);
    if (line === undefined) return null;
    return this.getLedger(line.ledgerId);
  }

  #resolveVoucherType(value) {
    if (typeof value !== "string") {
      throw new TallyCraftError(
        "UNKNOWN_VOUCHER_TYPE",
        "Voucher type is required",
      );
    }
    const key = value.trim();
    const definition =
      VOUCHER_TYPES_BY_CODE.get(key.toUpperCase()) ??
      VOUCHER_TYPES_BY_NAME.get(key) ??
      VOUCHER_TYPES_BY_SHORTCUT.get(key);
    if (definition === undefined) {
      throw new TallyCraftError(
        "UNKNOWN_VOUCHER_TYPE",
        `Unknown voucher type "${value}"`,
        {
          types: VOUCHER_TYPES.map((entry) => entry.name),
        },
      );
    }
    return definition.code;
  }

  /** Public alias so adapters can normalise a type before asking for a number. */
  resolveVoucherType(value) {
    return this.#resolveVoucherType(value);
  }

  createStockItem(input) {
    const name = normaliseName(input.name);
    if (name === "")
      throw new TallyCraftError("INVALID_NAME", "Stock item name is required");
    const existing = one(
      this.db,
      "SELECT id FROM stock_items WHERE name = ? COLLATE NOCASE",
      name,
    );
    if (existing !== null) {
      throw new TallyCraftError(
        "DUPLICATE_STOCK_ITEM",
        `Stock item "${name}" already exists`,
      );
    }
    const quantity = Number(input.openingQty ?? 0);
    const value = Number(input.openingValue ?? 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(value)) {
      throw new TallyCraftError(
        "INVALID_QUANTITY",
        "Opening quantity and value must be numeric",
      );
    }
    const unit = normaliseName(input.unit ?? "Nos") || "Nos";
    const result = run(
      this.db,
      `INSERT INTO stock_items (name, stock_group, unit, opening_qty_milli, opening_value_paise, gst_rate, hsn)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      name,
      input.group ?? null,
      unit,
      Math.round(quantity * 1000),
      Math.round(value * 100),
      Number(input.gstRate ?? 0),
      input.hsn ?? null,
    );
    return {
      id: Number(result.lastInsertRowid),
      name,
      group: input.group ?? null,
      unit,
      openingQty: quantity,
      openingValue: value,
      gstRate: Number(input.gstRate ?? 0),
      hsn: input.hsn ?? null,
    };
  }

  #insertInventory(voucherId, type, inventory) {
    if (!Array.isArray(inventory) || inventory.length === 0) return;
    const direction =
      type === "PURCHASE" || type === "CREDIT_NOTE"
        ? 1
        : type === "SALES" || type === "DEBIT_NOTE"
          ? -1
          : 0;
    if (direction === 0) {
      throw new TallyCraftError(
        "INVENTORY_ON_ACCOUNTING_VOUCHER",
        "Inventory lines are only supported on sales, purchase, credit-note and debit-note vouchers",
      );
    }
    const insert = this.db.prepare(
      `INSERT INTO voucher_inventory (voucher_id, stock_item_id, qty_milli, rate_paise, amount_paise)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const entry of inventory) {
      const item = one(
        this.db,
        "SELECT * FROM stock_items WHERE id = ? OR name = ? COLLATE NOCASE",
        typeof entry.itemId === "number" ? entry.itemId : -1,
        entry.item ?? entry.itemName ?? "",
      );
      if (item === null) {
        throw new TallyCraftError(
          "UNKNOWN_STOCK_ITEM",
          `No stock item "${entry.item ?? entry.itemId}"`,
        );
      }
      const qty = Math.round(Number(entry.quantity ?? entry.qty ?? 0) * 1000);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new TallyCraftError(
          "INVALID_QUANTITY",
          "Inventory quantity must be positive",
        );
      }
      const ratePaise =
        entry.rate === undefined ? 0 : parseSignedAmount(entry.rate, "Dr");
      const amountPaise =
        entry.amount === undefined
          ? Math.round((qty * ratePaise) / 1000)
          : Math.abs(parseSignedAmount(entry.amount, "Dr"));
      insert.run(
        voucherId,
        Number(item.id),
        direction * qty,
        ratePaise,
        amountPaise,
      );
    }
  }

  getVoucher(id) {
    const voucher = one(this.db, "SELECT * FROM vouchers WHERE id = ?", id);
    if (voucher === null)
      throw new TallyCraftError("UNKNOWN_VOUCHER", `No voucher with id ${id}`);
    const lines = all(
      this.db,
      `SELECT vl.*, l.name AS ledger_name, g.name AS group_name
       FROM voucher_lines vl
       JOIN ledgers l ON l.id = vl.ledger_id
       JOIN groups g ON g.id = l.group_id
       WHERE vl.voucher_id = ? ORDER BY vl.position`,
      id,
    );
    const inventory = all(
      this.db,
      `SELECT vi.*, si.name AS item_name, si.unit
       FROM voucher_inventory vi JOIN stock_items si ON si.id = vi.stock_item_id
       WHERE vi.voucher_id = ?`,
      id,
    );
    const party =
      voucher.party_ledger_id === null
        ? null
        : this.getLedger(Number(voucher.party_ledger_id));
    return {
      id: Number(voucher.id),
      type: voucher.type,
      typeName: VOUCHER_TYPES_BY_CODE.get(voucher.type)?.name ?? voucher.type,
      number: voucher.number,
      date: voucher.date,
      narration: voucher.narration,
      reference: voucher.reference,
      party,
      total: moneyNumber(Number(voucher.total_paise)),
      lines: lines.map((line) => ({
        id: Number(line.id),
        ledgerId: Number(line.ledger_id),
        ledger: line.ledger_name,
        group: line.group_name,
        amount: moneyNumber(Number(line.amount_paise)),
        debit:
          Number(line.amount_paise) > 0
            ? moneyNumber(Number(line.amount_paise))
            : 0,
        credit:
          Number(line.amount_paise) < 0
            ? moneyNumber(-Number(line.amount_paise))
            : 0,
        billRef: line.bill_ref,
      })),
      inventory: inventory.map((row) => ({
        item: row.item_name,
        unit: row.unit,
        quantity: Number(row.qty_milli) / 1000,
        rate: moneyNumber(Number(row.rate_paise)),
        amount: moneyNumber(Number(row.amount_paise)),
      })),
    };
  }

  listVouchers({
    from = null,
    to = null,
    type = null,
    ledgerId = null,
    search = null,
    limit = 200,
    offset = 0,
  } = {}) {
    const clauses = [];
    const params = [];
    if (from !== null) {
      clauses.push("v.date >= ?");
      params.push(from);
    }
    if (to !== null) {
      clauses.push("v.date <= ?");
      params.push(to);
    }
    if (type !== null) {
      clauses.push("v.type = ?");
      params.push(this.#resolveVoucherType(type));
    }
    if (ledgerId !== null) {
      clauses.push(
        "EXISTS (SELECT 1 FROM voucher_lines vl WHERE vl.voucher_id = v.id AND vl.ledger_id = ?)",
      );
      params.push(ledgerId);
    }
    if (search !== null && search.trim() !== "") {
      clauses.push(
        "(v.narration LIKE ? OR v.number LIKE ? OR v.reference LIKE ?)",
      );
      const needle = `%${search.trim()}%`;
      params.push(needle, needle, needle);
    }
    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    const rows = all(
      this.db,
      `SELECT v.*, l.name AS party_name
       FROM vouchers v LEFT JOIN ledgers l ON l.id = v.party_ledger_id
       ${where} ORDER BY v.date DESC, v.id DESC LIMIT ? OFFSET ?`,
      ...params,
      Math.min(Math.max(Number(limit) || 200, 1), 1000),
      Math.max(Number(offset) || 0, 0),
    );
    return rows.map((row) => ({
      id: Number(row.id),
      type: row.type,
      typeName: VOUCHER_TYPES_BY_CODE.get(row.type)?.name ?? row.type,
      number: row.number,
      date: row.date,
      narration: row.narration,
      reference: row.reference,
      party: row.party_name,
      total: moneyNumber(Number(row.total_paise)),
    }));
  }

  deleteVoucher(id) {
    const voucher = this.getVoucher(id);
    run(this.db, "DELETE FROM vouchers WHERE id = ?", id);
    return { deleted: voucher.id, number: voucher.number };
  }

  // ---------------------------------------------------------------- reports

  /** Signed movements per ledger: before `from`, and inside [from, to]. */
  #movements(from, to) {
    const rows = all(
      this.db,
      `SELECT vl.ledger_id AS ledgerId,
              COALESCE(SUM(CASE WHEN v.date < ? THEN vl.amount_paise ELSE 0 END), 0) AS before,
              COALESCE(SUM(CASE WHEN v.date >= ? AND v.date <= ? THEN vl.amount_paise ELSE 0 END), 0) AS inside
       FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id
       GROUP BY vl.ledger_id`,
      from,
      from,
      to,
    );
    const map = new Map();
    for (const row of rows) {
      map.set(Number(row.ledgerId), {
        before: Number(row.before),
        between: Number(row.inside),
      });
    }
    return map;
  }

  #company() {
    return this.getCompany();
  }

  /** Closing balance of every ledger at `asOf`. */
  balancesAt(asOf) {
    const movements = this.#movements("0000-01-01", asOf);
    return this.ledgerRows().map((ledger) => {
      const movement = movements.get(ledger.id) ?? { before: 0, between: 0 };
      return {
        ...ledger,
        balancePaise: ledger.openingPaise + movement.before + movement.between,
      };
    });
  }

  /** Balances only for the window [from, to], with the opening carried in. */
  balancesIn(from, to) {
    const movements = this.#movements(from, to);
    return this.ledgerRows().map((ledger) => {
      const movement = movements.get(ledger.id) ?? { before: 0, between: 0 };
      return {
        ...ledger,
        openingPaise: ledger.openingPaise + movement.before,
        movementPaise: movement.between,
        balancePaise: ledger.openingPaise + movement.before + movement.between,
      };
    });
  }

  #rollup(balances) {
    const { byName, roots } = this.groupTree();
    for (const ledger of balances) {
      const node = byName.get(ledger.group);
      if (node !== undefined) node.ledgers.push(ledger);
    }
    const compute = (node) => {
      const direct = node.ledgers.reduce(
        (sum, ledger) => sum + ledger.balancePaise,
        0,
      );
      const childTotal = node.groups.reduce(
        (sum, child) => sum + compute(child),
        0,
      );
      node.total = direct + childTotal;
      return node.total;
    };
    for (const root of roots) compute(root);
    return { byName, roots };
  }

  trialBalance({ asOf = null, detailed = true } = {}) {
    const company = this.#company();
    const date = asOf ?? company.financialYearEnd;
    assertIsoDate(date, "asOf");
    const balances = this.balancesAt(date);
    const { roots } = this.#rollup(balances);

    const rows = [];
    let debitTotal = 0;
    let creditTotal = 0;
    let ledgerCount = 0;

    const push = (name, amountPaise, kind, depth) => {
      rows.push({
        name,
        kind,
        depth,
        debit: amountPaise > 0 ? moneyNumber(amountPaise) : 0,
        credit: amountPaise < 0 ? moneyNumber(-amountPaise) : 0,
        balance: moneyNumber(amountPaise),
      });
    };

    const walk = (node, depth) => {
      if (node.total === 0 && node.ledgers.length === 0) return;
      push(node.name, node.total, "group", depth);
      for (const child of node.groups) walk(child, depth + 1);
      if (detailed) {
        for (const ledger of node.ledgers) {
          if (ledger.balancePaise === 0) continue;
          push(ledger.name, ledger.balancePaise, "ledger", depth + 1);
        }
      }
    };

    for (const root of roots) walk(root, 0);
    for (const ledger of balances) {
      if (ledger.balancePaise > 0) debitTotal += ledger.balancePaise;
      else creditTotal -= ledger.balancePaise;
      if (ledger.balancePaise !== 0) ledgerCount += 1;
    }

    return {
      asOf: date,
      company: company.name,
      rows,
      totals: {
        debit: moneyNumber(debitTotal),
        credit: moneyNumber(creditTotal),
      },
      balanced: debitTotal === creditTotal,
      difference: moneyNumber(debitTotal - creditTotal),
      ledgerCount,
    };
  }

  #sectionRows(roots, predicate) {
    return roots
      .filter((root) => predicate(root))
      .map((root) => ({
        name: root.name,
        amount: moneyNumber(Math.abs(root.total)),
        signed: moneyNumber(root.total),
        ledgers: root.ledgers
          .filter((ledger) => ledger.balancePaise !== 0)
          .map((ledger) => ({
            name: ledger.name,
            amount: moneyNumber(Math.abs(ledger.balancePaise)),
            signed: moneyNumber(ledger.balancePaise),
          })),
        groups: root.groups.map((child) => ({
          name: child.name,
          amount: moneyNumber(Math.abs(child.total)),
          ledgers: child.ledgers
            .filter((ledger) => ledger.balancePaise !== 0)
            .map((ledger) => ({
              name: ledger.name,
              amount: moneyNumber(Math.abs(ledger.balancePaise)),
              signed: moneyNumber(ledger.balancePaise),
            })),
        })),
      }));
  }

  /**
   * Replace the book value of Stock-in-Hand with the inventory-derived closing
   * stock, keeping the statement consistent with the periodic-inventory P&L.
   */
  #applyClosingStock(assetRows, onBooksPaise, closingPaise) {
    const rows = assetRows.map((row) => ({
      ...row,
      groups: row.groups.map((group) => ({
        ...group,
        ledgers: [...group.ledgers],
      })),
      ledgers: [...row.ledgers],
    }));
    let currentAssets = rows.find((row) => row.name === "Current Assets");
    if (currentAssets === undefined) {
      if (closingPaise === 0) return rows;
      currentAssets = {
        name: "Current Assets",
        amount: moneyNumber(0),
        signed: moneyNumber(0),
        groups: [],
        ledgers: [],
      };
      rows.unshift(currentAssets);
    }
    currentAssets.groups = currentAssets.groups.filter(
      (group) => group.name !== "Stock-in-Hand",
    );
    currentAssets.ledgers = currentAssets.ledgers.filter(
      (ledger) => ledger.name !== "Stock-in-Hand",
    );
    if (closingPaise !== 0) {
      currentAssets.groups.push({
        name: "Stock-in-Hand",
        amount: moneyNumber(closingPaise),
        ledgers: [
          {
            name: "Closing stock (inventory)",
            amount: moneyNumber(closingPaise),
            signed: moneyNumber(closingPaise),
          },
        ],
      });
    }
    const delta = closingPaise - onBooksPaise;
    currentAssets.amount = moneyNumber(toPaise(currentAssets.amount) + delta);
    currentAssets.signed = moneyNumber(toPaise(currentAssets.signed) + delta);
    return rows;
  }

  balanceSheet({ asOf = null } = {}) {
    const company = this.#company();
    const date = asOf ?? company.financialYearEnd;
    const balances = this.balancesAt(date);
    const { roots } = this.#rollup(balances);

    const liabilityRoots = roots.filter(
      (root) =>
        root.nature === "liabilities" && root.name !== "Profit & Loss A/c",
    );
    const reserveRoots = roots.filter(
      (root) => root.name === "Profit & Loss A/c",
    );
    const assetRoots = roots.filter((root) => root.nature === "assets");

    const profitAndLoss = this.profitLoss({
      from: company.financialYearStart,
      to: date,
    });
    const netProfitPaise = toPaise(profitAndLoss.netProfit);
    const reservesPaise = reserveRoots.reduce(
      (sum, root) => sum + root.total,
      0,
    );

    const stockOnBooksPaise = balances
      .filter((ledger) => ledger.group === "Stock-in-Hand")
      .reduce((sum, ledger) => sum + ledger.balancePaise, 0);
    const closingStockPaise = this.#stockRows(date).totalPaise;

    // `signed` is already in rupees, so negate it directly: passing it through
    // moneyNumber would divide by 100 a second time and shrink every liability
    // heading to one percent of its real value.
    const liabilities = this.#sectionRows(liabilityRoots, () => true).map(
      (row) => ({
        ...row,
        amount: -row.signed,
      }),
    );
    for (const row of this.#sectionRows(reserveRoots, () => true)) {
      liabilities.push({ ...row, amount: -row.signed });
    }
    const assets = this.#applyClosingStock(
      this.#sectionRows(assetRoots, () => true),
      stockOnBooksPaise,
      closingStockPaise,
    );

    const liabilityTotalPaise =
      liabilityRoots.reduce((sum, root) => sum + -root.total, 0) -
      reservesPaise;
    const assetTotalPaise =
      assetRoots.reduce((sum, root) => sum + root.total, 0) -
      stockOnBooksPaise +
      closingStockPaise;
    const balanceSheetLiabilities = liabilityTotalPaise + netProfitPaise;

    return {
      asOf: date,
      company: company.name,
      liabilities,
      assets,
      profitAndLoss: {
        name: "Profit & Loss A/c",
        amount: moneyNumber(Math.abs(netProfitPaise)),
        isLoss: netProfitPaise < 0,
      },
      reserves: moneyNumber(-reservesPaise),
      stock: {
        onBooks: moneyNumber(stockOnBooksPaise),
        closing: moneyNumber(closingStockPaise),
      },
      totals: {
        liabilities: moneyNumber(balanceSheetLiabilities),
        assets: moneyNumber(assetTotalPaise),
      },
      balanced: balanceSheetLiabilities === assetTotalPaise,
      difference: moneyNumber(assetTotalPaise - balanceSheetLiabilities),
    };
  }

  profitLoss({ from = null, to = null } = {}) {
    const company = this.#company();
    const start = from ?? company.financialYearStart;
    const end = to ?? company.financialYearEnd;
    const balances = this.balancesIn(start, end);
    const { roots } = this.#rollup(balances);

    const section = (name, selector) => {
      const chosen = roots.filter(selector);
      const totalPaise = chosen.reduce(
        (sum, root) =>
          sum + (root.nature === "income" ? -root.total : root.total),
        0,
      );
      return {
        name,
        rows: this.#sectionRows(chosen, () => true),
        total: moneyNumber(totalPaise),
      };
    };

    const directIncome = section(
      "Direct Incomes",
      (root) => profitLossSectionFor(root.name) === "direct_income",
    );
    const directExpense = section(
      "Direct Expenses",
      (root) => profitLossSectionFor(root.name) === "direct_expense",
    );
    const indirectIncome = section(
      "Indirect Incomes",
      (root) => profitLossSectionFor(root.name) === "indirect_income",
    );
    const indirectExpense = section(
      "Indirect Expenses",
      (root) => profitLossSectionFor(root.name) === "indirect_expense",
    );

    // Periodic inventory: opening stock is a trading debit and closing stock a
    // trading credit, derived from the inventory register rather than posted.
    const openingStockPaise = this.balancesAt(dateWithOffset(start, -1))
      .filter((ledger) => ledger.group === "Stock-in-Hand")
      .reduce((sum, ledger) => sum + ledger.balancePaise, 0);
    const closingStockPaise = this.#stockRows(end).totalPaise;
    if (openingStockPaise !== 0) {
      directExpense.rows.push({
        name: "Opening Stock",
        amount: moneyNumber(openingStockPaise),
        signed: moneyNumber(openingStockPaise),
        ledgers: [],
        groups: [],
      });
      directExpense.total = moneyNumber(
        toPaise(directExpense.total) + openingStockPaise,
      );
    }
    if (closingStockPaise !== 0) {
      directIncome.rows.push({
        name: "Closing Stock",
        amount: moneyNumber(closingStockPaise),
        signed: moneyNumber(closingStockPaise),
        ledgers: [],
        groups: [],
      });
      directIncome.total = moneyNumber(
        toPaise(directIncome.total) + closingStockPaise,
      );
    }

    const grossPaise = toPaise(directIncome.total - directExpense.total);
    const netPaise =
      grossPaise + toPaise(indirectIncome.total - indirectExpense.total);

    return {
      from: start,
      to: end,
      company: company.name,
      directIncome,
      directExpense,
      grossProfit: moneyNumber(grossPaise),
      indirectIncome,
      indirectExpense,
      netProfit: moneyNumber(netPaise),
      isLoss: netPaise < 0,
      stock: {
        opening: moneyNumber(openingStockPaise),
        closing: moneyNumber(closingStockPaise),
      },
    };
  }

  dayBook({ date = null, type = null } = {}) {
    const company = this.#company();
    const day = date ?? new Date().toISOString().slice(0, 10);
    assertIsoDate(day, "date");
    const clauses = ["v.date = ?"];
    const params = [day];
    if (type !== null) {
      clauses.push("v.type = ?");
      params.push(this.#resolveVoucherType(type));
    }
    const vouchers = all(
      this.db,
      `SELECT v.*, l.name AS party_name FROM vouchers v
       LEFT JOIN ledgers l ON l.id = v.party_ledger_id
       WHERE ${clauses.join(" AND ")} ORDER BY v.id`,
      ...params,
    );
    let debitTotal = 0;
    let creditTotal = 0;
    const rows = vouchers.map((voucher) => {
      const lines = all(
        this.db,
        `SELECT vl.amount_paise, l.name FROM voucher_lines vl JOIN ledgers l ON l.id = vl.ledger_id
         WHERE vl.voucher_id = ? ORDER BY vl.position`,
        voucher.id,
      );
      const debit = lines.filter((line) => Number(line.amount_paise) > 0);
      const credit = lines.filter((line) => Number(line.amount_paise) < 0);
      debitTotal += debit.reduce(
        (sum, line) => sum + Number(line.amount_paise),
        0,
      );
      creditTotal += credit.reduce(
        (sum, line) => sum + -Number(line.amount_paise),
        0,
      );
      return {
        id: Number(voucher.id),
        type: voucher.type,
        typeName: VOUCHER_TYPES_BY_CODE.get(voucher.type)?.name ?? voucher.type,
        number: voucher.number,
        narration: voucher.narration,
        party: voucher.party_name,
        total: moneyNumber(Number(voucher.total_paise)),
        debitLedgers: debit.map((line) => ({
          ledger: line.name,
          amount: moneyNumber(Number(line.amount_paise)),
        })),
        creditLedgers: credit.map((line) => ({
          ledger: line.name,
          amount: moneyNumber(-Number(line.amount_paise)),
        })),
      };
    });
    const known = one(
      this.db,
      "SELECT COUNT(*) AS n FROM vouchers WHERE date = ?",
      day,
    );
    return {
      date: day,
      company: company.name,
      vouchers: rows,
      totals: {
        debit: moneyNumber(debitTotal),
        credit: moneyNumber(creditTotal),
      },
      count: Number(known.n),
    };
  }

  ledgerReport({ ledgerId, from = null, to = null }) {
    const company = this.#company();
    const ledger = this.getLedger(ledgerId);
    const start = from ?? company.financialYearStart;
    const end = to ?? company.financialYearEnd;
    const openingPaise =
      ledger.openingPaise +
      Number(
        one(
          this.db,
          `SELECT COALESCE(SUM(vl.amount_paise),0) AS total FROM voucher_lines vl
           JOIN vouchers v ON v.id = vl.voucher_id WHERE vl.ledger_id = ? AND v.date < ?`,
          ledgerId,
          start,
        ).total,
      );
    const rows = all(
      this.db,
      `SELECT v.id, v.date, v.type, v.number, v.narration, vl.amount_paise, vl.bill_ref
       FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id
       WHERE vl.ledger_id = ? AND v.date >= ? AND v.date <= ?
       ORDER BY v.date, v.id`,
      ledgerId,
      start,
      end,
    );
    let running = openingPaise;
    // Totals accumulate paise, never the rupee figures rendered in each row:
    // moneyNumber() on an already-converted value would divide by 100 again.
    let debitTotalPaise = 0;
    let creditTotalPaise = 0;
    const entries = rows.map((row) => {
      const amount = Number(row.amount_paise);
      running += amount;
      if (amount > 0) debitTotalPaise += amount;
      else creditTotalPaise -= amount;
      const others = all(
        this.db,
        `SELECT l.name FROM voucher_lines vl JOIN ledgers l ON l.id = vl.ledger_id
         WHERE vl.voucher_id = ? AND vl.ledger_id <> ?`,
        row.id,
        ledgerId,
      ).map((line) => line.name);
      return {
        voucherId: Number(row.id),
        date: row.date,
        type: VOUCHER_TYPES_BY_CODE.get(row.type)?.name ?? row.type,
        number: row.number,
        particulars: others.join(", "),
        narration: row.narration,
        billRef: row.bill_ref,
        debit: amount > 0 ? moneyNumber(amount) : 0,
        credit: amount < 0 ? moneyNumber(-amount) : 0,
        balance: moneyNumber(running),
      };
    });
    return {
      ledger: { id: ledger.id, name: ledger.name, group: ledger.group },
      from: start,
      to: end,
      opening: moneyNumber(openingPaise),
      openingType: openingPaise >= 0 ? "Dr" : "Cr",
      entries,
      totals: {
        debit: moneyNumber(debitTotalPaise),
        credit: moneyNumber(creditTotalPaise),
      },
      closing: moneyNumber(running),
      closingType: running >= 0 ? "Dr" : "Cr",
    };
  }

  outstanding({ asOf = null, type = "receivable" } = {}) {
    const company = this.#company();
    const date = asOf ?? company.financialYearEnd;
    const groupName =
      type === "payable" ? "Sundry Creditors" : "Sundry Debtors";
    const balances = this.balancesAt(date).filter(
      (ledger) => ledger.group === groupName,
    );
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, older: 0 };
    let totalPaise = 0;
    const parties = [];
    for (const ledger of balances) {
      const balance =
        type === "payable" ? -ledger.balancePaise : ledger.balancePaise;
      if (balance === 0) continue;
      totalPaise += balance;
      const billRows = all(
        this.db,
        `SELECT v.date, v.number, v.type, vl.amount_paise, vl.bill_ref
         FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id
         WHERE vl.ledger_id = ? AND v.date <= ? ORDER BY v.date`,
        ledger.id,
        date,
      );
      if (ledger.openingPaise !== 0) {
        billRows.unshift({
          date: company.financialYearStart,
          number: "Opening balance",
          type: "OPENING",
          amount_paise: ledger.openingPaise,
          bill_ref: null,
        });
      }
      const bills = billRows.map((row) => {
        const signed =
          type === "payable"
            ? -Number(row.amount_paise)
            : Number(row.amount_paise);
        const ageDays = Math.max(
          0,
          Math.round(
            (Date.parse(`${date}T00:00:00Z`) -
              Date.parse(`${row.date}T00:00:00Z`)) /
              86_400_000,
          ),
        );
        const bucket =
          ageDays <= 30
            ? "current"
            : ageDays <= 60
              ? "d30"
              : ageDays <= 90
                ? "d60"
                : ageDays <= 180
                  ? "d90"
                  : "older";
        buckets[bucket] += signed;
        return {
          date: row.date,
          number: row.number,
          type:
            VOUCHER_TYPES_BY_CODE.get(row.type)?.name ??
            (row.type === "OPENING" ? "Opening" : row.type),
          billRef: row.bill_ref,
          amount: moneyNumber(signed),
          ageDays,
          bucket,
        };
      });
      parties.push({
        id: ledger.id,
        name: ledger.name,
        balance: moneyNumber(balance),
        creditDays: ledger.creditDays,
        bills,
      });
    }
    parties.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    return {
      asOf: date,
      type,
      group: groupName,
      parties,
      total: moneyNumber(totalPaise),
      ageing: {
        current: moneyNumber(buckets.current),
        d30: moneyNumber(buckets.d30),
        d60: moneyNumber(buckets.d60),
        d90: moneyNumber(buckets.d90),
        older: moneyNumber(buckets.older),
      },
    };
  }

  gstSummary({ from = null, to = null } = {}) {
    const company = this.#company();
    const start = from ?? company.financialYearStart;
    const end = to ?? company.financialYearEnd;
    const taxHead = (name) => {
      const upper = name.toUpperCase();
      if (/CGST/.test(upper)) return "CGST";
      if (/SGST|UTGST/.test(upper)) return "SGST";
      if (/IGST/.test(upper)) return "IGST";
      if (/CESS/.test(upper)) return "CESS";
      return "Other";
    };
    const balances = this.balancesIn(start, end).filter(
      (ledger) =>
        ledger.group === "Duties & Taxes" && ledger.movementPaise !== 0,
    );
    const lines = balances.map((ledger) => {
      const outputPaise = -ledger.movementPaise;
      return {
        ledger: ledger.name,
        tax: taxHead(ledger.name),
        kind: outputPaise > 0 ? "output" : "input",
        amount: moneyNumber(Math.abs(outputPaise)),
        signed: moneyNumber(ledger.movementPaise),
      };
    });
    const outputPaise = balances
      .filter((ledger) => ledger.movementPaise < 0)
      .reduce((sum, ledger) => sum - ledger.movementPaise, 0);
    const inputPaise = balances
      .filter((ledger) => ledger.movementPaise > 0)
      .reduce((sum, ledger) => sum + ledger.movementPaise, 0);
    return {
      from: start,
      to: end,
      lines,
      outputTotal: moneyNumber(outputPaise),
      inputTotal: moneyNumber(inputPaise),
      netPayable: moneyNumber(outputPaise - inputPaise),
    };
  }

  /** Inventory movement rows in paise; the single owner of stock valuation. */
  #stockRows(asOf) {
    const items = all(
      this.db,
      "SELECT * FROM stock_items ORDER BY name COLLATE NOCASE",
    );
    const movement = all(
      this.db,
      `SELECT vi.stock_item_id AS itemId,
              COALESCE(SUM(CASE WHEN vi.qty_milli > 0 THEN vi.qty_milli ELSE 0 END),0) AS inQty,
              COALESCE(SUM(CASE WHEN vi.qty_milli < 0 THEN -vi.qty_milli ELSE 0 END),0) AS outQty,
              COALESCE(SUM(CASE WHEN vi.qty_milli > 0 THEN vi.amount_paise ELSE 0 END),0) AS inValue
       FROM voucher_inventory vi JOIN vouchers v ON v.id = vi.voucher_id
       WHERE v.date <= ? GROUP BY vi.stock_item_id`,
      asOf,
    );
    const map = new Map(movement.map((row) => [Number(row.itemId), row]));
    let totalPaise = 0;
    const rows = items.map((item) => {
      const entry = map.get(Number(item.id));
      const openQty = Number(item.opening_qty_milli);
      const openValue = Number(item.opening_value_paise);
      const inQty = entry === undefined ? 0 : Number(entry.inQty);
      const outQty = entry === undefined ? 0 : Number(entry.outQty);
      const inValue = entry === undefined ? 0 : Number(entry.inValue);
      const closingQty = openQty + inQty - outQty;
      const denominator = openQty + inQty;
      const averageRate =
        denominator === 0
          ? 0
          : Math.round(((openValue + inValue) * 1000) / denominator);
      const closingValue = Math.round((closingQty * averageRate) / 1000);
      totalPaise += closingValue;
      return {
        id: Number(item.id),
        name: item.name,
        group: item.stock_group,
        unit: item.unit,
        gstRate: Number(item.gst_rate),
        openingQty: openQty,
        inwardQty: inQty,
        outwardQty: outQty,
        closingQty,
        averageRate,
        closingValue,
      };
    });
    return { rows, totalPaise };
  }

  stockSummary({ asOf = null } = {}) {
    const company = this.#company();
    const date = asOf ?? company.financialYearEnd;
    assertIsoDate(date, "asOf");
    const { rows, totalPaise } = this.#stockRows(date);
    return {
      asOf: date,
      company: company.name,
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        group: row.group,
        unit: row.unit,
        gstRate: row.gstRate,
        openingQty: row.openingQty / 1000,
        inwardQty: row.inwardQty / 1000,
        outwardQty: row.outwardQty / 1000,
        closingQty: row.closingQty / 1000,
        rate: moneyNumber(row.averageRate),
        value: moneyNumber(row.closingValue),
      })),
      totalValue: moneyNumber(totalPaise),
    };
  }

  statistics() {
    const company = this.getCompany();
    const count = (table) =>
      Number(one(this.db, `SELECT COUNT(*) AS n FROM ${table}`).n);
    const balances = this.balancesAt(company.financialYearEnd);
    const byGroup = (name) =>
      balances
        .filter((ledger) => ledger.group === name)
        .reduce((sum, ledger) => sum + ledger.balancePaise, 0);
    const profitAndLoss = this.profitLoss();
    return {
      company,
      counts: {
        ledgers: count("ledgers"),
        vouchers: count("vouchers"),
        groups: count("groups"),
        stockItems: count("stock_items"),
      },
      cashInHand: moneyNumber(byGroup("Cash-in-Hand")),
      bankBalance: moneyNumber(byGroup("Bank Accounts")),
      debtors: moneyNumber(byGroup("Sundry Debtors")),
      creditors: moneyNumber(-byGroup("Sundry Creditors")),
      netProfit: moneyNumber(toPaise(profitAndLoss.netProfit)),
    };
  }

  // -------------------------------------------------------------- Tally XML

  exportXml({ from = null, to = null, masters = true, vouchers = true } = {}) {
    const company = this.#company();
    const start = from ?? company.financialYearStart;
    const end = to ?? company.financialYearEnd;
    const parts = [];
    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    parts.push("<ENVELOPE>");
    parts.push(" <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>");
    parts.push(" <BODY>");
    parts.push("  <IMPORTDATA>");
    parts.push("   <REQUESTDESC>");
    parts.push("    <REPORTNAME>Vouchers</REPORTNAME>");
    parts.push("    <STATICVARIABLES>");
    parts.push(
      `     <SVCURRENTCOMPANY>${escapeXml(company.name)}</SVCURRENTCOMPANY>`,
    );
    parts.push(`     <SVFROMDATE>${start.replaceAll("-", "")}</SVFROMDATE>`);
    parts.push(`     <SVTODATE>${end.replaceAll("-", "")}</SVTODATE>`);
    parts.push("    </STATICVARIABLES>");
    parts.push("   </REQUESTDESC>");
    parts.push("   <REQUESTDATA>");

    if (masters) {
      for (const group of all(
        this.db,
        "SELECT * FROM groups ORDER BY parent IS NOT NULL, name",
      )) {
        if (Number(group.predefined) === 1) continue;
        parts.push(
          `    <TALLYMESSAGE><GROUP NAME="${escapeXml(group.name)}" ACTION="Create">`,
        );
        parts.push(`     <NAME>${escapeXml(group.name)}</NAME>`);
        if (group.parent !== null)
          parts.push(`     <PARENT>${escapeXml(group.parent)}</PARENT>`);
        parts.push("    </GROUP></TALLYMESSAGE>");
      }
      for (const ledger of this.ledgerRows()) {
        parts.push(
          `    <TALLYMESSAGE><LEDGER NAME="${escapeXml(ledger.name)}" ACTION="Create">`,
        );
        parts.push(`     <NAME>${escapeXml(ledger.name)}</NAME>`);
        parts.push(`     <PARENT>${escapeXml(ledger.group)}</PARENT>`);
        if (ledger.openingPaise !== 0) {
          parts.push(
            `     <OPENINGBALANCE>${xmlAmount(ledger.openingPaise)}</OPENINGBALANCE>`,
          );
        }
        if (ledger.gstin !== null)
          parts.push(
            `     <PARTYGSTIN>${escapeXml(ledger.gstin)}</PARTYGSTIN>`,
          );
        parts.push("     <ISBILLWISEON>Yes</ISBILLWISEON>");
        parts.push("    </LEDGER></TALLYMESSAGE>");
      }
    }

    if (vouchers) {
      const ids = all(
        this.db,
        "SELECT id FROM vouchers WHERE date BETWEEN ? AND ? ORDER BY date, id",
        start,
        end,
      ).map((row) => Number(row.id));
      for (const id of ids) {
        const voucher = this.getVoucher(id);
        parts.push(
          `    <TALLYMESSAGE><VOUCHER VCHTYPE="${escapeXml(voucher.typeName)}" ACTION="Create">`,
        );
        parts.push(`     <DATE>${voucher.date.replaceAll("-", "")}</DATE>`);
        parts.push(
          `     <VOUCHERTYPENAME>${escapeXml(voucher.typeName)}</VOUCHERTYPENAME>`,
        );
        parts.push(
          `     <VOUCHERNUMBER>${escapeXml(voucher.number)}</VOUCHERNUMBER>`,
        );
        if (voucher.narration !== null) {
          parts.push(
            `     <NARRATION>${escapeXml(voucher.narration)}</NARRATION>`,
          );
        }
        if (voucher.party !== null) {
          parts.push(
            `     <PARTYLEDGERNAME>${escapeXml(voucher.party.name)}</PARTYLEDGERNAME>`,
          );
        }
        for (const line of voucher.lines) {
          const isDebit = line.debit > 0;
          parts.push("     <ALLLEDGERENTRIES.LIST>");
          parts.push(
            `      <LEDGERNAME>${escapeXml(line.ledger)}</LEDGERNAME>`,
          );
          parts.push(
            `      <ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`,
          );
          const magnitude = isDebit ? line.debit : line.credit;
          const signed = isDebit ? -magnitude : magnitude;
          parts.push(`      <AMOUNT>${signed.toFixed(2)}</AMOUNT>`);
          if (line.billRef !== null) {
            parts.push("      <BILLALLOCATIONS.LIST>");
            parts.push(`       <NAME>${escapeXml(line.billRef)}</NAME>`);
            parts.push("       <BILLTYPE>New Ref</BILLTYPE>");
            parts.push(`       <AMOUNT>${signed.toFixed(2)}</AMOUNT>`);
            parts.push("      </BILLALLOCATIONS.LIST>");
          }
          parts.push("     </ALLLEDGERENTRIES.LIST>");
        }
        parts.push("    </VOUCHER></TALLYMESSAGE>");
      }
    }

    parts.push("   </REQUESTDATA>");
    parts.push("  </IMPORTDATA>");
    parts.push(" </BODY>");
    parts.push("</ENVELOPE>");
    return `${parts.join("\n")}\n`;
  }

  importXml(xml, { createMissingGroups = true, dryRun = false } = {}) {
    let document;
    try {
      document = parseXml(xml);
    } catch (error) {
      throw new TallyCraftError(
        "INVALID_XML",
        `Could not parse XML: ${error.message}`,
      );
    }
    const summary = {
      groups: 0,
      ledgers: 0,
      vouchers: 0,
      skipped: 0,
      warnings: [],
    };

    const importLedger = (node) => {
      const name = childText(node, "NAME");
      const parent = childText(node, "PARENT");
      if (name === null || name === "") {
        summary.skipped += 1;
        return;
      }
      let groupRow = one(
        this.db,
        "SELECT id FROM groups WHERE name = ? COLLATE NOCASE",
        parent ?? "",
      );
      if (groupRow === null) {
        const fallback =
          parent !== null && GROUPS_BY_NAME.has(`Sundry ${parent}`)
            ? `Sundry ${parent}`
            : "Suspense A/c";
        if (!createMissingGroups) {
          summary.warnings.push(
            `Group "${parent ?? "(none)"}" for ledger ${name} is unknown; used ${fallback}`,
          );
        }
        groupRow = one(
          this.db,
          "SELECT id FROM groups WHERE name = ?",
          fallback,
        );
      }
      const openingText = childText(node, "OPENINGBALANCE");
      const openingPaise =
        openingText === null ? 0 : Math.round(Number(openingText) * 100) || 0;
      const existing = one(
        this.db,
        "SELECT id FROM ledgers WHERE name = ? COLLATE NOCASE",
        name,
      );
      const gstin = childText(node, "PARTYGSTIN") ?? childText(node, "GSTIN");
      try {
        if (existing === null) {
          this.createLedger({
            name,
            group: String(
              one(this.db, "SELECT name FROM groups WHERE id = ?", groupRow.id)
                .name,
            ),
            opening: openingPaise / 100,
            openingType: openingPaise >= 0 ? "Dr" : "Cr",
            gstin,
          });
          summary.ledgers += 1;
        } else {
          summary.skipped += 1;
        }
      } catch (error) {
        summary.warnings.push(`Ledger ${name}: ${error.message}`);
        summary.skipped += 1;
      }
    };

    const importVoucher = (node) => {
      const typeName =
        node.attributes.VCHTYPE ??
        childText(node, "VOUCHERTYPENAME") ??
        childText(node, "VCHTYPE");
      const dateText =
        childText(node, "DATE") ?? childText(node, "VOUCHERDATE");
      if (typeName === null || dateText === null) {
        summary.skipped += 1;
        return;
      }
      const date =
        dateText.length === 8
          ? `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}`
          : dateText;
      const lines = [];
      for (const entry of [
        ...childrenNamed(node, "ALLLEDGERENTRIES.LIST"),
        ...childrenNamed(node, "LEDGERENTRIES.LIST"),
      ]) {
        const ledgerName = childText(entry, "LEDGERNAME");
        const amountText = childText(entry, "AMOUNT");
        if (ledgerName === null || amountText === null) continue;
        const raw = Number(amountText);
        if (!Number.isFinite(raw)) continue;
        // Tally marks a debit with ISDEEMEDPOSITIVE=Yes and usually writes the
        // amount negative. Trust the flag and the magnitude in that order so
        // both the common export shape and sign-only exports import correctly.
        const deemedPositive =
          (childText(entry, "ISDEEMEDPOSITIVE") ?? "No").toLowerCase() ===
          "yes";
        const magnitude = Math.abs(Math.round(raw * 100));
        const paise = deemedPositive ? magnitude : -magnitude;
        const billAllocations = childrenNamed(entry, "BILLALLOCATIONS.LIST");
        const billRef =
          billAllocations.length === 0
            ? null
            : childText(billAllocations[0], "NAME");
        lines.push({ ledger: ledgerName, amount: paise / 100, billRef });
      }
      if (lines.length < 2) {
        summary.skipped += 1;
        summary.warnings.push(
          `Voucher ${childText(node, "VOUCHERNUMBER") ?? "?"} has no readable entries`,
        );
        return;
      }
      try {
        // Always attempt the write, even for a preview: the surrounding
        // transaction is rolled back instead, so a dry run validates exactly
        // what a real import would do (duplicates, balance, financial year).
        this.createVoucher({
          type: typeName,
          date,
          number: childText(node, "VOUCHERNUMBER") ?? undefined,
          narration: childText(node, "NARRATION") ?? undefined,
          lines,
        });
        summary.vouchers += 1;
      } catch (error) {
        summary.skipped += 1;
        summary.warnings.push(
          `Voucher ${childText(node, "VOUCHERNUMBER") ?? "?"}: ${error.message}${
            error.details?.next === undefined
              ? ""
              : ` (next available ${error.details.next})`
          }`,
        );
      }
    };

    const result = transaction(
      this.db,
      () => {
        for (const node of findAll(document, ["LEDGER"])) importLedger(node);
        for (const node of findAll(document, ["VOUCHER"])) importVoucher(node);
        return summary;
      },
      { rollback: dryRun },
    );
    return dryRun ? { ...result, dryRun: true } : result;
  }
}

/** Convenience factory used by the CLI and server. */
export function openApp(filePath) {
  return TallyCraft.open(filePath);
}
