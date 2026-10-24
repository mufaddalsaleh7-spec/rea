#!/usr/bin/env node
/**
 * TallyCraft command line.
 *
 * The CLI and the browser client share the same service layer, so a report
 * printed here is the same object the UI renders.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatPaise } from "../src/money.js";
import { TallyCraft, TallyCraftError } from "../src/app.js";
import { seed } from "../src/seed.js";
import { createAppServer } from "../src/server.js";
import { instanceInfo, previewUrlFor } from "../src/instance.js";
import { ConfigError, resolveConfig } from "../src/config.js";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { VOUCHER_TYPES } from "../src/catalog.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDatabase =
  process.env.TALLYCRAFT_DB ?? resolve(projectRoot, "data", "tallycraft.db");
const publicDir = resolve(projectRoot, "public");

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        index += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

function usage() {
  return `TallyCraft - a double-entry accounting workspace

Usage
  tallycraft serve [--port 3000] [--host 0.0.0.0] [--db FILE] [--demo]
                  [--also-listen 8080,5173] [--public-url https://books.example.com]
  tallycraft seed [--db FILE]
  tallycraft report <name> [--as-of DATE] [--from DATE] [--to DATE] [--json]
  tallycraft ledger list|add [options]
  tallycraft voucher add --type Sales --date 2026-04-01 --dr "Cash:1000" --cr "Sales - Fabric:1000"
  tallycraft export [--out FILE] [--from DATE] [--to DATE]
  tallycraft import FILE [--dry-run]

Reports
  trial-balance, balance-sheet, profit-loss, day-book, outstanding,
  stock-summary, gst-summary

Voucher types
  ${VOUCHER_TYPES.map((type) => `${type.name} (${type.shortcut})`).join(", ")}

Environment
  PORT, HOST, TALLYCRAFT_DB, TALLYCRAFT_DEMO, TALLYCRAFT_ALIASES,
  PUBLIC_URL, TALLYCRAFT_RELEASE, NODE_ENV
  (see docs/DEPLOY.md; bad values stop the process at boot)
`;
}

function printMoneyTable(title, rows, columns) {
  const widths = columns.map((column, index) =>
    Math.max(
      column.header.length,
      ...rows.map((row) => String(row[index] ?? "").length),
    ),
  );
  const line = widths.map((width) => "-".repeat(width)).join("  ");
  console.log(`\n${title}`);
  console.log(
    columns
      .map((column, index) => column.header.padEnd(widths[index]))
      .join("  "),
  );
  console.log(line);
  for (const row of rows) {
    console.log(
      row
        .map((cell, index) =>
          columns[index].align === "right"
            ? String(cell ?? "").padStart(widths[index])
            : String(cell ?? "").padEnd(widths[index]),
        )
        .join("  "),
    );
  }
}

function money(value) {
  return formatPaise(Math.round(Number(value) * 100));
}

/** Read the checked-out branch and commit once at startup. */
function gitIdentity() {
  try {
    const dir = resolve(projectRoot, "..");
    return {
      branch: execFileSync(
        "git",
        ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim(),
      commit: execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    };
  } catch {
    return { branch: null, commit: null };
  }
}

async function commandServe(flags) {
  let config;
  try {
    config = resolveConfig(process.env, projectRoot);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error — ${error.message}`);
      process.exit(2);
    }
    throw error;
  }
  const port = Number(flags.port ?? config.port);
  const host = String(flags.host ?? config.host);
  const dbPath = String(flags.db ?? config.dbPath);
  const publicUrl =
    typeof flags["public-url"] === "string"
      ? flags["public-url"]
      : config.publicUrl;
  mkdirSync(dirname(dbPath), { recursive: true });

  const app = TallyCraft.open(dbPath);
  if (flags.demo === true || config.demo) {
    const result = seed(app);
    if (result.created)
      console.log(`Loaded demo company: ${result.company.name}`);
  } else {
    try {
      app.getCompany();
    } catch {
      console.log(
        "No company yet. Run `node bin/tallycraft.js seed` or POST /api/demo/reset.",
      );
    }
  }
  const startedAt = new Date();
  const identity = () =>
    instanceInfo({
      port,
      host,
      sandboxId: process.env.E2B_SANDBOX_ID,
      publicUrl,
      environment: config.environment,
      release: config.release,
      startedAt,
      pid: process.pid,
      dbPath,
      ...gitIdentity(),
      supervisorPid: process.ppid ?? null,
    });

  // Orphan guard: if the supervisor is killed outright (SIGKILL, EPIPE from a
  // closed log pipe), no signal handler runs for it. The server therefore
  // watches its parent and exits when it disappears, so the port is never held
  // by a process nobody owns.
  const parentPid = Number(
    flags["parent-pid"] ?? process.env.TALLYCRAFT_PARENT_PID ?? 0,
  );
  const watchParent = (server) => {
    if (
      !Number.isInteger(parentPid) ||
      parentPid <= 0 ||
      parentPid === process.pid
    )
      return;
    const timer = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        console.log(
          `parent ${parentPid} is gone; shutting down to release port ${port}`,
        );
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 2_000).unref();
      }
    }, 2_000);
    timer.unref();
  };

  const alsoListen = String(
    flags["also-listen"] ?? process.env.TALLYCRAFT_ALSO_LISTEN ?? "",
  )
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value !== port);
  // Aliases come from the flag, the legacy env var, or the resolved config.
  for (const alias of config.aliases) {
    if (alias !== port && !alsoListen.includes(alias)) alsoListen.push(alias);
  }

  const server = createAppServer({
    dbPath,
    publicDir,
    app,
    instance: identity,
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Start with --port <free port>.`,
      );
      process.exit(1);
    }
    throw error;
  });
  server.listenAll(port, host, alsoListen).then((bound) => {
    watchParent(server);
    const info = identity();
    console.log(`TallyCraft listening on http://${host}:${port}`);
    console.log(`Database: ${dbPath}`);
    if (info.previewUrl !== null) console.log(`Preview: ${info.previewUrl}`);
    // Advertise the resolved instance so a supervisor or an operator can find
    // this exact process without scanning ports.
    try {
      const runtimeDir = resolve(projectRoot, ".runtime");
      mkdirSync(runtimeDir, { recursive: true });
      writeFileSync(
        resolve(runtimeDir, "preview.json"),
        `${JSON.stringify(info, null, 2)}\n`,
      );
    } catch (error) {
      console.log(
        `warning: could not write .runtime/preview.json (${error.message})`,
      );
    }
    for (const alias of bound.aliases) {
      const aliasUrl = previewUrlFor(alias, process.env.E2B_SANDBOX_ID);
      console.log(
        `Alias: http://${host}:${alias}${aliasUrl === null ? "" : `  ${aliasUrl}`}`,
      );
    }
  });
  // Graceful shutdown. A container runtime sends SIGTERM and then SIGKILL
  // after its grace period; in between we stop accepting, let in-flight
  // requests finish, checkpoint SQLite through the normal close path, and
  // only then exit. A second signal means "now".
  let draining = false;
  const shutdown = (signal) => {
    if (draining) {
      console.log(`${signal} again; exiting immediately`);
      process.exit(1);
    }
    draining = true;
    console.log(`${signal} received; draining connections`);
    const force = setTimeout(() => {
      console.log("drain timeout; closing open connections");
      server.closeAllConnections();
      for (const alias of server.extraServers) alias.closeAllConnections();
    }, 8_000);
    force.unref();
    server.close(() => {
      clearTimeout(force);
      console.log("closed cleanly");
      process.exit(0);
    });
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => shutdown(signal));
  }
}

async function commandSeed(flags) {
  const app = TallyCraft.open(String(flags.db ?? defaultDatabase));
  const result = seed(app);
  console.log(
    result.created
      ? `Seeded ${result.company.name} with demo masters and vouchers.`
      : `Company ${result.company.name} already has data; nothing changed.`,
  );
  app.close();
}

async function commandReport(positional, flags) {
  const name = positional[0];
  const app = TallyCraft.open(String(flags.db ?? defaultDatabase));
  const asOf = typeof flags["as-of"] === "string" ? flags["as-of"] : null;
  const from = typeof flags.from === "string" ? flags.from : null;
  const to = typeof flags.to === "string" ? flags.to : null;
  let report;
  switch (name) {
    case "trial-balance":
      report = app.trialBalance({ asOf });
      break;
    case "balance-sheet":
      report = app.balanceSheet({ asOf });
      break;
    case "profit-loss":
      report = app.profitLoss({ from, to });
      break;
    case "day-book":
      report = app.dayBook({ date: asOf });
      break;
    case "outstanding":
      report = app.outstanding({ asOf });
      break;
    case "stock-summary":
      report = app.stockSummary({ asOf });
      break;
    case "gst-summary":
      report = app.gstSummary({ from, to });
      break;
    default:
      console.error(usage());
      process.exitCode = 2;
      app.close();
      return;
  }
  if (flags.json === true) {
    console.log(JSON.stringify(report, null, 2));
    app.close();
    return;
  }
  if (name === "trial-balance") {
    const rows = report.rows
      .filter((row) => row.kind === "ledger")
      .map((row) => [row.name, money(row.debit || 0), money(row.credit || 0)]);
    printMoneyTable(`Trial Balance as on ${report.asOf}`, rows, [
      { header: "Ledger" },
      { header: "Debit", align: "right" },
      { header: "Credit", align: "right" },
    ]);
    console.log(
      `\nTotal ${money(report.totals.debit)} Dr  ${money(report.totals.credit)} Cr  balanced=${report.balanced}`,
    );
  } else if (name === "balance-sheet") {
    const rows = [
      ...report.liabilities.map((row) => [row.name, money(row.amount)]),
      ["Profit & Loss A/c", money(report.profitAndLoss.amount)],
      ...report.assets.map((row) => [row.name, money(row.amount)]),
    ];
    printMoneyTable(`Balance Sheet as on ${report.asOf}`, rows, [
      { header: "Group" },
      { header: "Amount", align: "right" },
    ]);
    console.log(
      `\nLiabilities ${money(report.totals.liabilities)}  Assets ${money(report.totals.assets)}  balanced=${report.balanced}`,
    );
  } else if (name === "profit-loss") {
    const rows = [
      ["Direct Incomes", money(report.directIncome.total)],
      ["Direct Expenses", money(report.directExpense.total)],
      ["Gross Profit", money(report.grossProfit)],
      ["Indirect Incomes", money(report.indirectIncome.total)],
      ["Indirect Expenses", money(report.indirectExpense.total)],
      ["Net Profit", money(report.netProfit)],
    ];
    printMoneyTable(`Profit & Loss ${report.from} to ${report.to}`, rows, [
      { header: "Particulars" },
      { header: "Amount", align: "right" },
    ]);
  } else if (name === "stock-summary") {
    printMoneyTable(
      `Stock Summary as on ${report.asOf}`,
      report.rows.map((row) => [
        row.name,
        String(row.closingQty),
        row.unit,
        money(row.value),
      ]),
      [
        { header: "Item" },
        { header: "Qty", align: "right" },
        { header: "Unit" },
        { header: "Value", align: "right" },
      ],
    );
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  app.close();
}

async function commandLedger(positional, flags) {
  const app = TallyCraft.open(String(flags.db ?? defaultDatabase));
  const action = positional[0] ?? "list";
  if (action === "list") {
    const ledgers = app.listLedgers({
      group: typeof flags.group === "string" ? flags.group : null,
    });
    printMoneyTable(
      `Ledgers (${ledgers.length})`,
      ledgers.map((ledger) => [
        ledger.name,
        ledger.group,
        money(ledger.opening >= 0 ? ledger.opening : -ledger.opening) +
          (ledger.opening >= 0 ? " Dr" : " Cr"),
      ]),
      [
        { header: "Ledger" },
        { header: "Group" },
        { header: "Opening", align: "right" },
      ],
    );
  } else if (action === "add") {
    const name = positional[1] ?? flags.name;
    if (typeof name !== "string" || typeof flags.group !== "string") {
      throw new TallyCraftError(
        "USAGE",
        'ledger add needs a name and --group "Group Name"',
      );
    }
    const opening = Number(flags.opening ?? 0);
    const ledger = app.createLedger({
      name,
      group: flags.group,
      opening: Math.abs(opening),
      openingType: flags.cr === true || opening < 0 ? "Cr" : "Dr",
      gstin: typeof flags.gstin === "string" ? flags.gstin : null,
    });
    console.log(`Created ledger ${ledger.name} under ${ledger.group}`);
  } else {
    console.error(usage());
    process.exitCode = 2;
  }
  app.close();
}

async function commandVoucher(positional, flags) {
  const app = TallyCraft.open(String(flags.db ?? defaultDatabase));
  if ((positional[0] ?? "add") !== "add") {
    console.error(usage());
    process.exitCode = 2;
    app.close();
    return;
  }
  const lines = [];
  for (const [flag, debit] of [
    ["dr", true],
    ["cr", false],
  ]) {
    const values = [];
    for (let index = 0; index < process.argv.length; index += 1) {
      if (process.argv[index] === `--${flag}`)
        values.push(process.argv[index + 1]);
    }
    for (const value of values) {
      if (typeof value !== "string") continue;
      const separator = value.lastIndexOf(":");
      if (separator === -1)
        throw new TallyCraftError(
          "USAGE",
          `Expected "--${flag} Ledger:Amount"`,
        );
      const ledger = value.slice(0, separator).trim();
      const amount = Number(value.slice(separator + 1));
      lines.push(
        debit ? { ledger, debit: amount } : { ledger, credit: amount },
      );
    }
  }
  const result = app.createVoucher({
    type: String(flags.type ?? "Journal"),
    date: String(flags.date ?? new Date().toISOString().slice(0, 10)),
    narration: typeof flags.narration === "string" ? flags.narration : null,
    lines,
  });
  console.log(
    `${result.voucher.typeName} ${result.voucher.number} saved for ${result.voucher.total}`,
  );
  for (const warning of result.warnings)
    console.log(`warning: ${warning.message}`);
  app.close();
}

async function commandExport(flags) {
  const app = TallyCraft.open(String(flags.db ?? defaultDatabase));
  const xml = app.exportXml({
    from: typeof flags.from === "string" ? flags.from : null,
    to: typeof flags.to === "string" ? flags.to : null,
  });
  if (typeof flags.out === "string") {
    await writeFile(flags.out, xml, "utf8");
    console.log(`Wrote ${flags.out} (${xml.length} bytes)`);
  } else {
    process.stdout.write(xml);
  }
  app.close();
}

async function commandImport(positional, flags) {
  const file = positional[0];
  if (file === undefined) {
    console.error("import needs a file path");
    process.exitCode = 2;
    return;
  }
  const app = TallyCraft.open(String(flags.db ?? defaultDatabase));
  const xml = await readFile(file, "utf8");
  const result = app.importXml(xml, { dryRun: flags["dry-run"] === true });
  console.log(JSON.stringify(result, null, 2));
  app.close();
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);
  try {
    switch (command) {
      case undefined:
      case "--help":
      case "help":
        console.log(usage());
        break;
      case "serve":
        await commandServe(flags);
        break;
      case "seed":
        await commandSeed(flags);
        break;
      case "report":
        await commandReport(positional, flags);
        break;
      case "ledger":
        await commandLedger(positional, flags);
        break;
      case "voucher":
        await commandVoucher(positional, flags);
        break;
      case "export":
        await commandExport(flags);
        break;
      case "import":
        await commandImport(positional, flags);
        break;
      default:
        console.error(usage());
        process.exitCode = 2;
    }
  } catch (error) {
    if (error instanceof TallyCraftError) {
      console.error(`error [${error.code}]: ${error.message}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}

await main();
