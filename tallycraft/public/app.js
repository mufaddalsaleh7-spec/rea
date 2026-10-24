/**
 * TallyCraft browser client.
 *
 * A small hash-routed single page app. All figures come from the JSON API;
 * the client never recomputes a balance, so what is on screen is exactly what
 * the ledger says.
 */

const state = {
  catalog: null,
  company: null,
  statistics: null,
  screen: "gateway",
  params: {},
  ledgers: [],
  detailed: true,
};

const view = document.getElementById("view");
const ticker = document.getElementById("ticker");
const tickerText = document.getElementById("ticker-text");
const tickerAction = document.getElementById("ticker-action");
const nav = document.getElementById("mainnav");

const money = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmt(value) {
  const number = Number(value ?? 0);
  return money.format(Number.isFinite(number) ? number : 0);
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style") node.setAttribute("style", value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "html") node.innerHTML = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
  return node;
}

/**
 * Boot payload inlined by the server into index.html.
 *
 * A preview proxy can block or rewrite `/api/*` while still serving the shell.
 * When that happens the first paint must still show the real ledger, so these
 * responses double as a fallback for read-only screens.
 */
const BOOT = (() => {
  const node = document.getElementById("tallycraft-boot");
  if (node === null) return {};
  try {
    return JSON.parse(node.textContent ?? "{}");
  } catch {
    return {};
  }
})();

/**
 * Reveal the "offline copy" badge.
 *
 * It only appears once a request has actually fallen back, so a healthy
 * session never claims to be running from the inlined copy.
 */
let bootModeShown = false;
function markBootMode() {
  if (bootModeShown) return;
  bootModeShown = true;
  const note = document.getElementById("tallycraft-boot-mode");
  if (note !== null) note.hidden = false;
}

/** Fallback for a read request, or null when nothing was inlined for it. */
function bootFallback(path) {
  if (BOOT[path] === undefined) return null;
  markBootMode();
  return structuredClone(BOOT[path]);
}

async function api(path, options = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  const isRead = method === "GET" || method === "HEAD";

  let response;
  try {
    response = await fetch(path, {
      headers: { "content-type": "application/json", ...options.headers },
      ...options,
    });
  } catch (error) {
    // Network failure (proxy blocked, offline): serve the inlined copy.
    const fallback = isRead ? bootFallback(path) : null;
    if (fallback !== null) return fallback;
    throw error;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    const fallback =
      isRead && response.status >= 500 ? bootFallback(path) : null;
    if (fallback !== null) return fallback;
    let message = `${response.status} ${response.statusText}`;
    if (contentType.includes("application/json")) {
      const body = await response.json().catch(() => null);
      message = body?.error?.message ?? message;
    }
    throw new Error(message);
  }
  return contentType.includes("application/json")
    ? response.json()
    : response.text();
}

let tickerTimer = null;

function notify(message, kind = "info", action = null) {
  ticker.hidden = false;
  ticker.dataset.kind = kind;
  tickerText.textContent = message;
  if (action === null) {
    tickerAction.hidden = true;
  } else {
    tickerAction.hidden = false;
    tickerAction.textContent = action.label;
    tickerAction.onclick = action.run;
  }
  clearTimeout(tickerTimer);
  if (kind === "ok")
    tickerTimer = setTimeout(() => (ticker.hidden = true), 4200);
}

function idle(message = "") {
  if (message === "") {
    ticker.hidden = true;
    return;
  }
  notify(message, "info");
}

function setNav(screen) {
  for (const button of nav.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.nav === screen);
  }
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

/** Change a report parameter for the current route only, then repaint. */
function setOverride(key, value) {
  state.overrides = { ...state.overrides, [key]: value };
  state.params = { ...state.params, [key]: value };
  render();
}

/* ------------------------------------------------------------------ header */

function paintHeader() {
  const company = state.company;
  document.getElementById("brand-company").textContent = company
    ? `${company.name} · ${company.state ?? "India"}`
    : "No company loaded";
  document.getElementById("fy-label").textContent = company
    ? `FY ${company.financialYearStart.slice(0, 4)}–${company.financialYearEnd.slice(2, 4)}`
    : "FY —";
}

setInterval(() => {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString(
    "en-IN",
    {
      hour: "2-digit",
      minute: "2-digit",
    },
  );
}, 1000);

/* ------------------------------------------------------------------ router */

const ROUTES = [
  [/^#\/gateway$/, () => ({ screen: "gateway" })],
  [/^#\/masters$/, () => ({ screen: "masters" })],
  [/^#\/vouchers$/, () => ({ screen: "vouchers" })],
  [
    /^#\/voucher\/new\?type=([A-Z_]+)$/,
    (match) => ({ screen: "voucher-new", type: match[1] }),
  ],
  [/^#\/reports$/, () => ({ screen: "reports" })],
  [/^#\/report\/([a-z-]+)$/, (match) => ({ screen: "report", name: match[1] })],
  [
    /^#\/report\/ledger\/(\d+)$/,
    (match) => ({
      screen: "report",
      name: "ledger",
      ledgerId: Number(match[1]),
    }),
  ],
  [/^#\/data$/, () => ({ screen: "data" })],
];

function parseHash() {
  const hash = location.hash === "" ? "#/gateway" : location.hash;
  for (const [pattern, handler] of ROUTES) {
    const match = pattern.exec(hash);
    if (match !== null) return handler(match);
  }
  return { screen: "gateway" };
}

async function render() {
  const route = parseHash();
  const routeKey = `${route.screen}:${route.name ?? ""}:${route.ledgerId ?? ""}`;
  if (state.routeKey !== routeKey) {
    state.routeKey = routeKey;
    state.overrides = {};
  }
  state.screen = route.screen;
  state.params = { ...route, ...state.overrides };
  setNav(
    route.screen === "report" || route.screen === "vouchers"
      ? route.screen === "report"
        ? "reports"
        : "vouchers"
      : route.screen,
  );
  view.replaceChildren(el("div", { class: "loading" }, "Loading…"));
  try {
    switch (route.screen) {
      case "gateway":
        await renderGateway();
        break;
      case "masters":
        await renderMasters();
        break;
      case "vouchers":
        await renderVouchers();
        break;
      case "voucher-new":
        await renderVoucherEntry(route.type);
        break;
      case "reports":
        renderReportsIndex();
        break;
      case "report":
        await renderReport(route.name, route);
        break;
      case "data":
        await renderData();
        break;
      default:
        await renderGateway();
    }
  } catch (error) {
    view.replaceChildren(
      el(
        "div",
        { class: "card" },
        el("h2", {}, "Could not load this screen"),
        el("p", { class: "muted" }, error.message),
      ),
    );
  }
}

/* ----------------------------------------------------------------- gateway */

async function renderGateway() {
  const [stats, vouchers] = await Promise.all([
    api("/api/statistics"),
    api("/api/vouchers?limit=7"),
  ]);
  state.statistics = stats;

  const cashBank = Number(stats.cashInHand) + Number(stats.bankBalance);
  const hero = el(
    "section",
    { class: "grid cols-4" },
    statCard(
      "Cash & bank",
      fmt(cashBank),
      `Cash ${fmt(stats.cashInHand)} · Bank ${fmt(stats.bankBalance)}`,
      "accent",
    ),
    statCard(
      "Sundry debtors",
      fmt(stats.debtors),
      "Receivable from customers",
      "debit",
    ),
    statCard(
      "Sundry creditors",
      fmt(stats.creditors),
      "Payable to suppliers",
      "credit",
    ),
    statCard(
      Number(stats.netProfit) >= 0 ? "Net profit" : "Net loss",
      fmt(Math.abs(Number(stats.netProfit))),
      "Year to date, after depreciation",
      Number(stats.netProfit) >= 0 ? "debit" : "credit",
    ),
  );

  const txItems = [
    [
      "F4",
      "Contra voucher",
      "Cash to bank, bank to cash",
      "#/voucher/new?type=CONTRA",
    ],
    ["F5", "Payment voucher", "Money going out", "#/voucher/new?type=PAYMENT"],
    ["F6", "Receipt voucher", "Money coming in", "#/voucher/new?type=RECEIPT"],
    [
      "F7",
      "Journal voucher",
      "Adjustments and transfers",
      "#/voucher/new?type=JOURNAL",
    ],
    ["F8", "Sales voucher", "Invoice a customer", "#/voucher/new?type=SALES"],
    [
      "F9",
      "Purchase voucher",
      "Book a supplier bill",
      "#/voucher/new?type=PURCHASE",
    ],
  ];
  const reportItems = [
    ["—", "Trial balance", "Every ledger, Dr and Cr", "#/report/trial-balance"],
    ["—", "Balance sheet", "Assets and liabilities", "#/report/balance-sheet"],
    ["—", "Profit & loss", "Trading and indirect", "#/report/profit-loss"],
    ["—", "Day book", "Vouchers for one date", "#/report/day-book"],
    ["—", "Outstanding", "Receivables and ageing", "#/report/outstanding"],
    ["—", "Stock summary", "Quantity and value", "#/report/stock-summary"],
  ];

  const recent = el(
    "section",
    { class: "card", style: "margin-top:16px" },
    el(
      "h2",
      {},
      "Recent vouchers",
      el("a", { class: "small", href: "#/vouchers" }, "All transactions →"),
    ),
    vouchers.vouchers.length === 0
      ? el(
          "div",
          { class: "empty" },
          "No vouchers yet. Press F8 to raise the first invoice.",
        )
      : el(
          "div",
          { class: "table-wrap" },
          el(
            "table",
            { class: "data" },
            el(
              "thead",
              {},
              el(
                "tr",
                {},
                el("th", {}, "Date"),
                el("th", {}, "Type"),
                el("th", {}, "Number"),
                el("th", {}, "Party"),
                el("th", {}, "Narration"),
                el("th", { class: "num" }, "Amount"),
              ),
            ),
            el(
              "tbody",
              {},
              vouchers.vouchers.map((voucher) =>
                el(
                  "tr",
                  {
                    style: "cursor:pointer",
                    onclick: () => openVoucher(voucher.id),
                  },
                  el("td", { class: "nowrap mono" }, voucher.date),
                  el("td", {}, voucher.typeName),
                  el("td", { class: "mono" }, voucher.number),
                  el("td", {}, voucher.party ?? "—"),
                  el("td", { class: "muted" }, voucher.narration ?? "—"),
                  el("td", { class: "num" }, fmt(voucher.total)),
                ),
              ),
            ),
          ),
        ),
  );

  view.replaceChildren(
    el(
      "div",
      { class: "page-head" },
      el(
        "div",
        {},
        el("h1", {}, "Gateway of Tally"),
        el(
          "p",
          { class: "sub" },
          `${stats.company.name} · ${stats.counts.ledgers} ledgers · ${stats.counts.vouchers} vouchers · ${stats.counts.stockItems} stock items`,
        ),
      ),
      el(
        "div",
        { class: "head-tools" },
        el("span", { class: "badge ok" }, "Double entry enforced"),
        el(
          "button",
          {
            class: "button",
            onclick: () => navigate("#/report/trial-balance"),
          },
          "Trial balance",
        ),
        el(
          "button",
          {
            class: "button primary",
            onclick: () => navigate("#/voucher/new?type=SALES"),
          },
          "New sales invoice",
        ),
      ),
    ),
    hero,
    el(
      "section",
      { class: "grid split", style: "margin-top:16px" },
      el(
        "div",
        { class: "card" },
        el("h2", {}, "Transactions & masters"),
        el(
          "div",
          { class: "gateway-list" },
          txItems.map((item) => gatewayItem(item)),
        ),
        el("div", { class: "gateway-section-title" }, "Master data"),
        el(
          "div",
          { class: "gateway-list" },
          gatewayItem(
            ["Alt", "Create ledger", "Add an account", "#/masters"],
            true,
          ),
        ),
      ),
      el(
        "div",
        { class: "card" },
        el(
          "h2",
          {},
          "Reports",
          el("a", { class: "small", href: "#/reports" }, "All reports →"),
        ),
        el(
          "div",
          { class: "gateway-list" },
          reportItems.map((item) => gatewayItem(item)),
        ),
      ),
    ),
    recent,
  );
}

function statCard(label, value, hint, tone) {
  return el(
    "article",
    { class: `card stat ${tone}` },
    el("div", { class: "label" }, label),
    el("div", { class: "value" }, value),
    el("div", { class: "hint" }, hint),
  );
}

function gatewayItem([key, label, meta, href], alt = false) {
  const keyLabel = alt ? "Alt+L" : key;
  return el(
    "button",
    { class: "gateway-item", onclick: () => navigate(href) },
    el("span", { class: "gi-key" }, keyLabel),
    el("span", { class: "gi-label" }, label),
    el("span", { class: "gi-meta" }, meta),
  );
}

/* ----------------------------------------------------------------- masters */

async function renderMasters() {
  const [ledgerResponse, stock] = await Promise.all([
    api("/api/ledgers"),
    api("/api/reports/stock-summary"),
  ]);
  state.ledgers = ledgerResponse.ledgers;

  const search = el("input", {
    type: "search",
    placeholder: "Search ledgers…",
    oninput: (event) => filterLedgerRows(event.target.value),
  });

  const groupFilter = el(
    "select",
    {
      onchange: (event) => {
        const value = event.target.value;
        for (const row of document.querySelectorAll("#ledger-body tr")) {
          row.hidden = value !== "" && row.dataset.group !== value;
        }
      },
    },
    el("option", { value: "" }, "All groups"),
    [...new Set(state.ledgers.map((ledger) => ledger.group))]
      .sort()
      .map((group) => el("option", { value: group }, group)),
  );

  const table = el(
    "div",
    { class: "card", style: "margin-top:16px" },
    el(
      "h2",
      {},
      "Chart of accounts",
      el(
        "button",
        { class: "button primary", onclick: openLedgerForm },
        "Create ledger",
      ),
    ),
    el(
      "div",
      { class: "toolbar" },
      search,
      groupFilter,
      el("span", { class: "spacer" }),
      el("span", { class: "badge neutral" }, `${state.ledgers.length} ledgers`),
    ),
    el(
      "div",
      { class: "table-wrap" },
      el(
        "table",
        { class: "data" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", {}, "Ledger"),
            el("th", {}, "Group"),
            el("th", { class: "num" }, "Opening balance"),
            el("th", {}, "Nature"),
            el("th", {}, ""),
          ),
        ),
        el(
          "tbody",
          { id: "ledger-body" },
          state.ledgers.map((ledger) =>
            el(
              "tr",
              {
                dataset: {
                  group: ledger.group,
                  name: ledger.name.toLowerCase(),
                },
              },
              el("td", {}, ledger.name),
              el("td", { class: "muted" }, ledger.group),
              el(
                "td",
                { class: "num" },
                `${fmt(Math.abs(ledger.opening))} ${ledger.opening >= 0 ? "Dr" : "Cr"}`,
              ),
              el(
                "td",
                { class: "muted" },
                ledger.nature === "assets"
                  ? "Asset"
                  : ledger.nature === "liabilities"
                    ? "Liability"
                    : ledger.nature === "income"
                      ? "Income"
                      : "Expense",
              ),
              el(
                "td",
                { class: "row-actions" },
                el(
                  "button",
                  {
                    class: "button ghost small",
                    onclick: () => navigate(`#/report/ledger/${ledger.id}`),
                  },
                  "Statement",
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );

  const stockCard = el(
    "div",
    { class: "card", style: "margin-top:16px" },
    el(
      "h2",
      {},
      "Stock items",
      el("span", { class: "small" }, `Value ${fmt(stock.totalValue)}`),
    ),
    stock.rows.length === 0
      ? el("div", { class: "empty" }, "No stock items yet.")
      : el(
          "div",
          { class: "table-wrap" },
          el(
            "table",
            { class: "data" },
            el(
              "thead",
              {},
              el(
                "tr",
                {},
                el("th", {}, "Item"),
                el("th", {}, "Group"),
                el("th", {}, "Unit"),
                el("th", { class: "num" }, "Inward"),
                el("th", { class: "num" }, "Outward"),
                el("th", { class: "num" }, "Closing"),
                el("th", { class: "num" }, "Rate"),
                el("th", { class: "num" }, "Value"),
              ),
            ),
            el(
              "tbody",
              {},
              stock.rows.map((row) =>
                el(
                  "tr",
                  {},
                  el("td", {}, row.name),
                  el("td", { class: "muted" }, row.group ?? "—"),
                  el("td", {}, row.unit),
                  el("td", { class: "num" }, row.inwardQty),
                  el("td", { class: "num" }, row.outwardQty),
                  el("td", { class: "num" }, row.closingQty),
                  el("td", { class: "num" }, fmt(row.rate)),
                  el("td", { class: "num" }, fmt(row.value)),
                ),
              ),
            ),
          ),
        ),
  );

  view.replaceChildren(
    el(
      "div",
      { class: "page-head" },
      el(
        "div",
        {},
        el("h1", {}, "Masters"),
        el("p", { class: "sub" }, "Ledgers, groups and stock items"),
      ),
    ),
    table,
    stockCard,
  );
}

function filterLedgerRows(query) {
  const needle = query.trim().toLowerCase();
  for (const row of document.querySelectorAll("#ledger-body tr")) {
    row.hidden = needle !== "" && !row.dataset.name.includes(needle);
  }
}

function openLedgerForm() {
  const groups = [
    ...new Set(state.catalog.groups.map((group) => group.name)),
  ].sort();
  const form = el(
    "form",
    {
      class: "grid",
      onsubmit: async (event) => {
        event.preventDefault();
        const data = new FormData(event.target);
        try {
          const ledger = await api("/api/ledgers", {
            method: "POST",
            body: JSON.stringify({
              name: data.get("name"),
              group: data.get("group"),
              opening: Number(data.get("opening") ?? 0),
              openingType: data.get("openingType"),
              gstin: data.get("gstin") || null,
            }),
          });
          closeModal();
          notify(`Ledger ${ledger.name} created under ${ledger.group}`, "ok");
          render();
        } catch (error) {
          notify(error.message, "error");
        }
      },
    },
    el(
      "label",
      { class: "field" },
      "Ledger name",
      el("input", {
        name: "name",
        required: true,
        placeholder: "e.g. Ganesh Traders",
      }),
    ),
    el(
      "label",
      { class: "field" },
      "Under group",
      el(
        "select",
        { name: "group" },
        groups.map((group) => el("option", { value: group }, group)),
      ),
    ),
    el(
      "div",
      { class: "grid cols-2" },
      el(
        "label",
        { class: "field" },
        "Opening balance",
        el("input", {
          name: "opening",
          class: "num",
          type: "number",
          step: "0.01",
          value: "0",
        }),
      ),
      el(
        "label",
        { class: "field" },
        "Balance type",
        el(
          "select",
          { name: "openingType" },
          el("option", { value: "Dr" }, "Debit (Dr)"),
          el("option", { value: "Cr" }, "Credit (Cr)"),
        ),
      ),
    ),
    el(
      "label",
      { class: "field" },
      "GSTIN (optional)",
      el("input", { name: "gstin", placeholder: "24AAAAA0000A1Z5" }),
    ),
    el(
      "div",
      { class: "row-actions" },
      el(
        "button",
        { class: "button primary", type: "submit" },
        "Create ledger",
      ),
    ),
  );
  openModal("Create ledger", form);
}

/* ------------------------------------------------------------ transactions */

async function renderVouchers() {
  const [response, catalog] = await Promise.all([
    api("/api/vouchers?limit=300"),
    Promise.resolve(state.catalog),
  ]);
  const rows = response.vouchers;
  const total = rows.reduce((sum, voucher) => sum + Number(voucher.total), 0);

  const filter = el(
    "select",
    {
      onchange: (event) => {
        const value = event.target.value;
        for (const row of document.querySelectorAll("#voucher-body tr")) {
          row.hidden = value !== "" && row.dataset.type !== value;
        }
      },
    },
    el("option", { value: "" }, "All voucher types"),
    catalog.voucherTypes.map((type) =>
      el("option", { value: type.code }, type.name),
    ),
  );

  view.replaceChildren(
    el(
      "div",
      { class: "page-head" },
      el(
        "div",
        {},
        el("h1", {}, "Transactions"),
        el(
          "p",
          { class: "sub" },
          `${rows.length} vouchers · ${fmt(total)} gross`,
        ),
      ),
      el(
        "div",
        { class: "head-tools" },
        ...[
          ["CONTRA", "F4"],
          ["PAYMENT", "F5"],
          ["RECEIPT", "F6"],
          ["JOURNAL", "F7"],
          ["SALES", "F8"],
          ["PURCHASE", "F9"],
        ].map(([type, key]) =>
          el(
            "button",
            {
              class: "button",
              onclick: () => navigate(`#/voucher/new?type=${type}`),
            },
            `${catalog.voucherTypes.find((entry) => entry.code === type)?.name ?? type}`,
            el("kbd", {}, key),
          ),
        ),
      ),
    ),
    el(
      "div",
      { class: "card" },
      el(
        "div",
        { class: "toolbar" },
        filter,
        el("span", { class: "spacer" }),
        el("span", { class: "badge neutral" }, `${rows.length} rows`),
      ),
      rows.length === 0
        ? el("div", { class: "empty" }, "No vouchers yet.")
        : el(
            "div",
            { class: "table-wrap" },
            el(
              "table",
              { class: "data" },
              el(
                "thead",
                {},
                el(
                  "tr",
                  {},
                  el("th", {}, "Date"),
                  el("th", {}, "Type"),
                  el("th", {}, "Number"),
                  el("th", {}, "Party"),
                  el("th", {}, "Narration"),
                  el("th", { class: "num" }, "Amount"),
                  el("th", {}, ""),
                ),
              ),
              el(
                "tbody",
                { id: "voucher-body" },
                rows.map((voucher) =>
                  el(
                    "tr",
                    { dataset: { type: voucher.type } },
                    el("td", { class: "mono nowrap" }, voucher.date),
                    el("td", {}, voucher.typeName),
                    el("td", { class: "mono" }, voucher.number),
                    el("td", {}, voucher.party ?? "—"),
                    el("td", { class: "muted" }, voucher.narration ?? "—"),
                    el("td", { class: "num" }, fmt(voucher.total)),
                    el(
                      "td",
                      { class: "row-actions" },
                      el(
                        "button",
                        {
                          class: "button ghost small",
                          onclick: () => openVoucher(voucher.id),
                        },
                        "Open",
                      ),
                      el(
                        "button",
                        {
                          class: "button ghost small danger",
                          onclick: async () => {
                            if (!confirm(`Delete ${voucher.number}?`)) return;
                            try {
                              await api(`/api/vouchers/${voucher.id}`, {
                                method: "DELETE",
                              });
                              notify(`${voucher.number} deleted`, "ok");
                              render();
                            } catch (error) {
                              notify(error.message, "error");
                            }
                          },
                        },
                        "Delete",
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
    ),
  );
}

async function openVoucher(id) {
  try {
    const voucher = await api(`/api/vouchers/${id}`);
    openModal(
      `${voucher.typeName} ${voucher.number}`,
      el(
        "div",
        {},
        el(
          "div",
          { class: "grid cols-2", style: "margin-bottom:12px" },
          el(
            "div",
            {},
            el("div", { class: "muted small" }, "Date"),
            el("div", { class: "mono" }, voucher.date),
          ),
          el(
            "div",
            {},
            el("div", { class: "muted small" }, "Party"),
            el("div", {}, voucher.party?.name ?? "—"),
          ),
        ),
        el(
          "table",
          { class: "data" },
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              el("th", {}, "Ledger"),
              el("th", { class: "num" }, "Debit"),
              el("th", { class: "num" }, "Credit"),
            ),
          ),
          el(
            "tbody",
            {},
            voucher.lines.map((line) =>
              el(
                "tr",
                {},
                el("td", {}, line.ledger),
                el(
                  "td",
                  { class: "num debit" },
                  line.debit > 0 ? fmt(line.debit) : "",
                ),
                el(
                  "td",
                  { class: "num credit" },
                  line.credit > 0 ? fmt(line.credit) : "",
                ),
              ),
            ),
          ),
        ),
        voucher.inventory.length > 0
          ? el(
              "div",
              { style: "margin-top:14px" },
              el("h3", { class: "small muted" }, "Inventory allocation"),
              el(
                "table",
                { class: "data" },
                el(
                  "tbody",
                  {},
                  voucher.inventory.map((entry) =>
                    el(
                      "tr",
                      {},
                      el("td", {}, entry.item),
                      el(
                        "td",
                        { class: "num" },
                        `${entry.quantity} ${entry.unit}`,
                      ),
                      el("td", { class: "num" }, fmt(entry.rate)),
                      el("td", { class: "num" }, fmt(entry.amount)),
                    ),
                  ),
                ),
              ),
            )
          : null,
        voucher.narration
          ? el(
              "p",
              { class: "muted", style: "margin-top:12px" },
              voucher.narration,
            )
          : null,
      ),
      [el("button", { class: "button", onclick: closeModal }, "Close")],
    );
  } catch (error) {
    notify(error.message, "error");
  }
}

/* ---------------------------------------------------------- voucher entry */

async function renderVoucherEntry(typeCode) {
  const [{ ledgers }, stock] = await Promise.all([
    api("/api/ledgers"),
    api("/api/reports/stock-summary"),
  ]);
  const definition = state.catalog.voucherTypes.find(
    (entry) => entry.code === typeCode,
  );
  const date = new Date().toISOString().slice(0, 10);
  const { number } = await api(
    `/api/vouchers/next?type=${typeCode}&date=${date}`,
  );
  const supportsInventory = [
    "SALES",
    "PURCHASE",
    "CREDIT_NOTE",
    "DEBIT_NOTE",
  ].includes(typeCode);
  const partyLedger =
    typeCode === "SALES" || typeCode === "CREDIT_NOTE"
      ? "Sundry Debtors"
      : typeCode === "PURCHASE" || typeCode === "DEBIT_NOTE"
        ? "Sundry Creditors"
        : null;

  const inventoryRows = [];
  const linesBody = el("tbody");
  const inventoryBody = el("tbody");

  const meter = el("div", { class: "balance-meter" });
  const lines = [];

  const readTotals = () => {
    let debit = 0;
    let credit = 0;
    for (const line of lines) {
      const debitValue = Number(line.debitInput.value || 0);
      const creditValue = Number(line.creditInput.value || 0);
      debit += Number.isFinite(debitValue) ? debitValue : 0;
      credit += Number.isFinite(creditValue) ? creditValue : 0;
    }
    return { debit, credit };
  };

  const paintMeter = () => {
    const { debit, credit } = readTotals();
    const difference = Math.round((debit - credit) * 100) / 100;
    meter.replaceChildren(
      el(
        "div",
        { class: "row" },
        el("span", {}, "Total debit"),
        el("strong", { class: "mono" }, fmt(debit)),
      ),
      el(
        "div",
        { class: "row" },
        el("span", {}, "Total credit"),
        el("strong", { class: "mono" }, fmt(credit)),
      ),
      el(
        "div",
        { class: "row" },
        el("span", {}, "Difference"),
        el("strong", { class: "mono" }, fmt(Math.abs(difference))),
      ),
      el(
        "div",
        { class: `status ${difference === 0 ? "ok" : "bad"}` },
        difference === 0
          ? "Voucher balanced — press Ctrl+A to accept"
          : `Voucher differs by ${fmt(Math.abs(difference))}`,
      ),
    );
  };

  const addLine = (initial = {}) => {
    const row = {
      debitInput: el("input", {
        class: "num",
        inputmode: "decimal",
        placeholder: "0.00",
        value: initial.debit ?? "",
      }),
      creditInput: el("input", {
        class: "num",
        inputmode: "decimal",
        placeholder: "0.00",
        value: initial.credit ?? "",
      }),
    };
    row.ledgerSelect = ledgerSelect(initial.ledger ?? "");
    for (const input of [row.debitInput, row.creditInput]) {
      input.addEventListener("input", () => {
        if (input === row.debitInput && input.value !== "")
          row.creditInput.value = "";
        if (input === row.creditInput && input.value !== "")
          row.debitInput.value = "";
        paintMeter();
      });
    }
    const tr = el(
      "tr",
      {},
      el("td", {}, row.ledgerSelect),
      el("td", {}, row.debitInput),
      el("td", {}, row.creditInput),
      el(
        "td",
        { style: "width:34px" },
        el(
          "button",
          {
            class: "remove-line",
            type: "button",
            title: "Remove line",
            onclick: () => {
              const index = lines.indexOf(row);
              if (index !== -1) lines.splice(index, 1);
              tr.remove();
              paintMeter();
            },
          },
          "×",
        ),
      ),
    );
    row.tr = tr;
    lines.push(row);
    linesBody.append(tr);
    paintMeter();
    return row;
  };

  function ledgerSelect(selected) {
    const groups = new Map();
    for (const ledger of ledgers) {
      if (!groups.has(ledger.group)) groups.set(ledger.group, []);
      groups.get(ledger.group).push(ledger);
    }
    return el(
      "select",
      {},
      el("option", { value: "" }, "Select ledger…"),
      [...groups.entries()].map(([group, entries]) =>
        el(
          "optgroup",
          { label: group },
          entries.map((ledger) =>
            el(
              "option",
              { value: ledger.name, selected: ledger.name === selected },
              ledger.name,
            ),
          ),
        ),
      ),
    );
  }

  const inventoryTotalCell = el("td", { class: "num muted" }, "—");

  const addInventoryRow = (initial = {}) => {
    const row = {
      item: el(
        "select",
        {},
        el("option", { value: "" }, "Select item…"),
        stock.rows.map((entry) =>
          el(
            "option",
            { value: entry.name, selected: initial.item === entry.name },
            `${entry.name} (${entry.unit})`,
          ),
        ),
      ),
      qty: el("input", {
        class: "num",
        inputmode: "decimal",
        placeholder: "0",
        value: initial.qty ?? "",
      }),
      rate: el("input", {
        class: "num",
        inputmode: "decimal",
        placeholder: "0.00",
        value: initial.rate ?? "",
      }),
    };
    const amountCell = el("td", { class: "num" }, "—");
    const repaint = () => {
      const amount = Number(row.qty.value || 0) * Number(row.rate.value || 0);
      amountCell.textContent = amount > 0 ? fmt(amount) : "—";
      const total = inventoryRows.reduce((sum, entry) => {
        const value =
          Number(entry.qty.value || 0) * Number(entry.rate.value || 0);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);
      inventoryTotalCell.textContent = total > 0 ? fmt(total) : "—";
    };
    row.qty.addEventListener("input", repaint);
    row.rate.addEventListener("input", repaint);
    const tr = el(
      "tr",
      {},
      el("td", {}, row.item),
      el("td", {}, row.qty),
      el("td", {}, row.rate),
      amountCell,
      el(
        "td",
        { style: "width:34px" },
        el(
          "button",
          {
            class: "remove-line",
            type: "button",
            onclick: () => {
              const index = inventoryRows.indexOf(row);
              if (index !== -1) inventoryRows.splice(index, 1);
              tr.remove();
              repaint();
            },
          },
          "×",
        ),
      ),
    );
    row.tr = tr;
    inventoryRows.push(row);
    inventoryBody.append(tr);
    repaint();
  };

  const narration = el("textarea", {
    placeholder: "Narration, e.g. Invoice RT/104 against order 22",
  });
  const dateInput = el("input", { type: "date", value: date });
  const numberInput = el("input", { value: number, class: "mono" });
  const partySelect =
    partyLedger === null
      ? null
      : el(
          "select",
          {},
          el("option", { value: "" }, "Select party…"),
          ledgers
            .filter((ledger) => ledger.group === partyLedger)
            .map((ledger) => el("option", { value: ledger.name }, ledger.name)),
        );
  partySelect?.addEventListener("change", () => {
    const target =
      lines.find((line) => line.ledgerSelect.value === "") ?? lines[0];
    if (target !== undefined) target.ledgerSelect.value = partySelect.value;
  });

  const save = async () => {
    const payloadLines = [];
    for (const line of lines) {
      const ledger = line.ledgerSelect.value;
      const debit = Number(line.debitInput.value || 0);
      const credit = Number(line.creditInput.value || 0);
      if (ledger === "") continue;
      if (!debit && !credit) continue;
      payloadLines.push(debit ? { ledger, debit } : { ledger, credit });
    }
    const inventory = inventoryRows
      .filter((row) => row.item.value !== "" && Number(row.qty.value) > 0)
      .map((row) => ({
        item: row.item.value,
        qty: Number(row.qty.value),
        rate: Number(row.rate.value || 0),
      }));
    try {
      const result = await api("/api/vouchers", {
        method: "POST",
        body: JSON.stringify({
          type: typeCode,
          date: dateInput.value,
          number: numberInput.value.trim() || undefined,
          narration: narration.value.trim() || undefined,
          partyLedgerId: partySelect?.value || undefined,
          lines: payloadLines,
          inventory,
        }),
      });
      notify(
        `${result.voucher.typeName} ${result.voucher.number} accepted for ${fmt(result.voucher.total)}`,
        "ok",
        { label: "View day book", run: () => navigate("#/report/day-book") },
      );
      for (const warning of result.warnings)
        notify(`${result.voucher.number}: ${warning.message}`, "info");
      navigate("#/vouchers");
    } catch (error) {
      notify(error.message, "error");
    }
  };

  addLine();
  addLine();
  if (supportsInventory) addInventoryRow();

  const sheet = el(
    "section",
    { class: "voucher-sheet" },
    el(
      "div",
      { class: "voucher-head" },
      el(
        "div",
        { class: "vtype" },
        definition?.name ?? typeCode,
        el("span", { class: "vt-key" }, definition?.shortcut ?? ""),
      ),
      el("div", { class: "grow" }),
      el("label", { class: "field" }, "No.", numberInput),
      el("label", { class: "field" }, "Date", dateInput),
      partySelect
        ? el("label", { class: "field" }, partyLedger, partySelect)
        : null,
    ),
    el(
      "div",
      { class: "voucher-body" },
      el(
        "table",
        { class: "lines-table" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", { style: "width:48%" }, "Particulars"),
            el("th", { class: "num", style: "width:20%" }, "Debit"),
            el("th", { class: "num", style: "width:20%" }, "Credit"),
            el("th", { style: "width:34px" }, ""),
          ),
        ),
        linesBody,
      ),
      el(
        "div",
        { style: "padding:8px 4px" },
        el(
          "button",
          {
            class: "button ghost small",
            type: "button",
            onclick: () => addLine(),
          },
          "+ Add ledger line",
        ),
      ),
    ),
    supportsInventory
      ? el(
          "div",
          { class: "inventory-block" },
          el(
            "div",
            { class: "inv-title" },
            "Inventory allocation",
            el(
              "button",
              {
                class: "button ghost small",
                type: "button",
                onclick: () => addInventoryRow(),
              },
              "+ Add item",
            ),
          ),
          el(
            "table",
            {},
            el(
              "thead",
              {},
              el(
                "tr",
                {},
                el("th", {}, "Item"),
                el("th", { class: "num" }, "Qty"),
                el("th", { class: "num" }, "Rate"),
                el("th", { class: "num" }, "Amount"),
                el("th", {}, ""),
              ),
            ),
            inventoryBody,
            el(
              "tfoot",
              {},
              el(
                "tr",
                {},
                el(
                  "td",
                  { colspan: "3", class: "muted small" },
                  "Inventory total",
                ),
                inventoryTotalCell,
                el("td", {}),
              ),
            ),
          ),
        )
      : null,
    el(
      "div",
      { class: "voucher-foot" },
      el(
        "div",
        { class: "narration" },
        el("label", { class: "field" }, "Narration", narration),
      ),
      meter,
    ),
    el(
      "div",
      {
        style:
          "display:flex;gap:8px;justify-content:flex-end;padding:0 18px 18px",
      },
      el(
        "button",
        { class: "button", onclick: () => history.back() },
        "Cancel",
      ),
      el(
        "button",
        { class: "button primary", onclick: save },
        "Accept",
        el("kbd", {}, "Ctrl+A"),
      ),
    ),
  );

  view.replaceChildren(
    el(
      "div",
      { class: "page-head" },
      el(
        "div",
        {},
        el("h1", {}, `${definition?.name ?? typeCode} voucher`),
        el(
          "p",
          { class: "sub" },
          `Numbering ${state.catalog.voucherTypes.find((entry) => entry.code === typeCode)?.prefix ?? ""}-#### · debit and credit must agree before the voucher can be accepted`,
        ),
      ),
      el(
        "div",
        { class: "head-tools" },
        el(
          "button",
          { class: "button", onclick: () => navigate("#/vouchers") },
          "All transactions",
        ),
      ),
    ),
    sheet,
  );
}

/* ----------------------------------------------------------------- reports */

function renderReportsIndex() {
  const reports = [
    [
      "trial-balance",
      "Trial Balance",
      "Every ledger with its debit or credit balance, plus the accounting equation check.",
    ],
    [
      "balance-sheet",
      "Balance Sheet",
      "Liabilities and assets as on a date, with inventory-derived closing stock.",
    ],
    [
      "profit-loss",
      "Profit & Loss",
      "Trading account and indirect income and expenses for a date range.",
    ],
    ["day-book", "Day Book", "Every voucher posted on one date."],
    [
      "ledger",
      "Ledger Statement",
      "One account with opening, movements and closing balance.",
    ],
    [
      "outstanding",
      "Outstanding",
      "Receivables or payables with ageing buckets.",
    ],
    [
      "stock-summary",
      "Stock Summary",
      "Quantity and value by item, using weighted average cost.",
    ],
    [
      "gst-summary",
      "GST Summary",
      "Output tax, input credit and net payable for a period.",
    ],
  ];
  view.replaceChildren(
    el(
      "div",
      { class: "page-head" },
      el(
        "div",
        {},
        el("h1", {}, "Reports"),
        el("p", { class: "sub" }, "All figures derive from posted vouchers"),
      ),
    ),
    el(
      "section",
      { class: "grid cols-2" },
      reports.map(([name, title, description]) =>
        el(
          "button",
          {
            class: "card",
            style:
              "text-align:left;cursor:pointer;border:1px solid var(--line)",
            onclick: () => navigate(`#/report/${name}`),
          },
          el("h2", {}, title, el("span", { class: "small muted" }, "Open →")),
          el("p", { class: "muted small", style: "margin:0" }, description),
        ),
      ),
    ),
  );
}

function reportHead(title, subtitle, tools) {
  return el(
    "div",
    { class: "page-head" },
    el("div", {}, el("h1", {}, title), el("p", { class: "sub" }, subtitle)),
    el("div", { class: "head-tools" }, tools),
  );
}

async function renderReport(name, route) {
  switch (name) {
    case "trial-balance":
      await renderTrialBalance();
      break;
    case "balance-sheet":
      await renderBalanceSheet();
      break;
    case "profit-loss":
      await renderProfitLoss();
      break;
    case "day-book":
      await renderDayBook();
      break;
    case "ledger":
      await renderLedgerReport(route.ledgerId);
      break;
    case "outstanding":
      await renderOutstanding();
      break;
    case "stock-summary":
      await renderStockSummary();
      break;
    case "gst-summary":
      await renderGstSummary();
      break;
    default:
      renderReportsIndex();
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function renderTrialBalance() {
  const asOf = state.params.asOf ?? state.company.financialYearEnd;
  const report = await api(
    `/api/reports/trial-balance?asOf=${asOf}&detailed=${state.detailed}`,
  );
  const rows = report.rows;

  const table = el(
    "div",
    { class: "table-wrap" },
    el(
      "table",
      { class: "data" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", {}, "Particulars"),
          el("th", { class: "num" }, "Debit"),
          el("th", { class: "num" }, "Credit"),
        ),
      ),
      el(
        "tbody",
        {},
        rows.map((row) =>
          el(
            "tr",
            {
              class:
                row.kind === "group"
                  ? row.depth === 0
                    ? "group-row"
                    : "subgroup-row"
                  : "",
            },
            el("td", { class: `indent-${Math.min(row.depth, 2)}` }, row.name),
            el("td", { class: "num debit" }, row.debit ? fmt(row.debit) : ""),
            el(
              "td",
              { class: "num credit" },
              row.credit ? fmt(row.credit) : "",
            ),
          ),
        ),
        el(
          "tr",
          { class: "total-row" },
          el("td", {}, "Total"),
          el("td", { class: "num" }, fmt(report.totals.debit)),
          el("td", { class: "num" }, fmt(report.totals.credit)),
        ),
      ),
    ),
  );

  const dateInput = el("input", {
    type: "date",
    value: asOf,
    onchange: (event) => setOverride("asOf", event.target.value),
  });

  view.replaceChildren(
    reportHead(
      "Trial Balance",
      `${report.company} · ${report.ledgerCount} ledgers with balances · as on`,
      [
        dateInput,
        el(
          "button",
          {
            class: "button",
            onclick: () => {
              state.detailed = !state.detailed;
              render();
            },
          },
          state.detailed ? "Summary view" : "Detailed view",
        ),
        el(
          "button",
          { class: "button", onclick: () => window.print() },
          "Print",
        ),
      ],
    ),
    el(
      "div",
      { class: "card" },
      el(
        "div",
        { class: "toolbar" },
        el(
          "span",
          { class: `badge ${report.balanced ? "ok" : "bad"}` },
          report.balanced
            ? "Debits equal credits"
            : `Out by ${fmt(report.difference)}`,
        ),
        el("span", { class: "spacer" }),
        el(
          "span",
          { class: "muted small" },
          `Difference ${fmt(report.difference)}`,
        ),
      ),
      table,
    ),
  );
}

async function renderBalanceSheet() {
  const asOf = state.params.asOf ?? state.company.financialYearEnd;
  const report = await api(`/api/reports/balance-sheet?asOf=${asOf}`);

  const block = (title, rows, extra) =>
    el(
      "div",
      { class: "card" },
      el("h2", {}, title),
      el(
        "table",
        { class: "data" },
        el(
          "tbody",
          {},
          rows.map((row) =>
            el(
              "tr",
              { class: "group-row" },
              el("td", {}, row.name),
              el("td", { class: "num" }, fmt(row.amount)),
            ),
          ),
          ...rows.flatMap((row) =>
            (row.groups ?? []).flatMap((group) => [
              el(
                "tr",
                { class: "subgroup-row" },
                el("td", { class: "indent-1" }, group.name),
                el("td", { class: "num" }, fmt(group.amount)),
              ),
              ...group.ledgers.map((ledger) =>
                el(
                  "tr",
                  {},
                  el("td", { class: "indent-2" }, ledger.name),
                  el("td", { class: "num" }, fmt(ledger.amount)),
                ),
              ),
            ]),
          ),
          ...(extra ?? []),
          el(
            "tr",
            { class: "total-row" },
            el("td", {}, "Total"),
            el(
              "td",
              { class: "num" },
              fmt(
                title === "Liabilities"
                  ? report.totals.liabilities
                  : report.totals.assets,
              ),
            ),
          ),
        ),
      ),
    );

  const extraLiabilities = [
    el(
      "tr",
      { class: "group-row" },
      el("td", {}, "Profit & Loss A/c"),
      el(
        "td",
        { class: "num" },
        fmt(report.profitAndLoss.amount) +
          (report.profitAndLoss.isLoss ? " (loss)" : ""),
      ),
    ),
  ];

  view.replaceChildren(
    reportHead("Balance Sheet", `${report.company} · as on`, [
      el("input", {
        type: "date",
        value: asOf,
        onchange: (event) => setOverride("asOf", event.target.value),
      }),
      el("button", { class: "button", onclick: () => window.print() }, "Print"),
    ]),
    el(
      "div",
      { class: "toolbar" },
      el(
        "span",
        { class: `badge ${report.balanced ? "ok" : "bad"}` },
        report.balanced
          ? "Assets equal liabilities"
          : `Difference ${fmt(report.difference)}`,
      ),
      el(
        "span",
        { class: "badge neutral" },
        `Closing stock ${fmt(report.stock.closing)}`,
      ),
      el("span", { class: "spacer" }),
      el(
        "span",
        { class: "muted small" },
        "Inventory replaces the stock ledger balance; the movement is in the P&L.",
      ),
    ),
    el(
      "section",
      { class: "grid cols-2" },
      block("Liabilities", report.liabilities, extraLiabilities),
      block("Assets", report.assets),
    ),
  );
}

async function renderProfitLoss() {
  const from = state.params.from ?? state.company.financialYearStart;
  const to = state.params.to ?? state.company.financialYearEnd;
  const report = await api(`/api/reports/profit-loss?from=${from}&to=${to}`);

  const section = (title, data) =>
    el(
      "div",
      {},
      el(
        "h3",
        {
          class: "subgroup-row",
          style: "padding:8px 0;margin:8px 0 4px;font-size:13px",
        },
        title,
        el("span", { class: "num" }, fmt(data.total)),
      ),
      el(
        "table",
        { class: "data" },
        el(
          "tbody",
          {},
          data.rows.flatMap((row) => [
            el(
              "tr",
              { class: "subgroup-row" },
              el("td", {}, row.name),
              el("td", { class: "num" }, fmt(row.amount)),
            ),
            ...row.ledgers.map((ledger) =>
              el(
                "tr",
                {},
                el("td", { class: "indent-1" }, ledger.name),
                el("td", { class: "num" }, fmt(ledger.amount)),
              ),
            ),
          ]),
        ),
      ),
    );

  const dateRange = el(
    "div",
    { style: "display:flex;gap:8px" },
    el("input", {
      type: "date",
      value: from,
      onchange: (event) => setOverride("from", event.target.value),
    }),
    el("input", {
      type: "date",
      value: to,
      onchange: (event) => setOverride("to", event.target.value),
    }),
  );

  view.replaceChildren(
    reportHead("Profit & Loss", `${report.company} · ${from} to ${to}`, [
      dateRange,
      el("button", { class: "button", onclick: () => window.print() }, "Print"),
    ]),
    el(
      "div",
      { class: "grid cols-2" },
      el(
        "div",
        { class: "card" },
        el("h2", {}, "Trading account"),
        section("Direct incomes", report.directIncome),
        section("Direct expenses", report.directExpense),
        el(
          "div",
          { class: "list-plain", style: "margin-top:14px" },
          el(
            "li",
            {},
            el("span", {}, "Gross profit"),
            el("strong", { class: "mono" }, fmt(report.grossProfit)),
          ),
        ),
      ),
      el(
        "div",
        { class: "card" },
        el("h2", {}, "Profit & loss account"),
        section("Indirect incomes", report.indirectIncome),
        section("Indirect expenses", report.indirectExpense),
        el(
          "div",
          { class: "list-plain", style: "margin-top:14px" },
          el(
            "li",
            {},
            el("span", {}, "Gross profit b/f"),
            el("strong", { class: "mono" }, fmt(report.grossProfit)),
          ),
          el(
            "li",
            { style: "font-size:15px" },
            el("strong", {}, report.isLoss ? "Net loss" : "Net profit"),
            el("strong", { class: "mono" }, fmt(report.netProfit)),
          ),
          el(
            "li",
            {},
            el("span", {}, "Opening stock"),
            el("strong", { class: "mono" }, fmt(report.stock.opening)),
          ),
          el(
            "li",
            {},
            el("span", {}, "Closing stock"),
            el("strong", { class: "mono" }, fmt(report.stock.closing)),
          ),
        ),
      ),
    ),
  );
}

async function renderDayBook() {
  let date = state.params.asOf;
  if (date === undefined) {
    const latest = await api("/api/vouchers?limit=1");
    date = latest.vouchers[0]?.date ?? today();
  }
  const report = await api(`/api/reports/day-book?date=${date}`);
  view.replaceChildren(
    reportHead("Day Book", `${report.company} · ${report.count} vouchers on`, [
      el("input", {
        type: "date",
        value: date,
        onchange: (event) => setOverride("asOf", event.target.value),
      }),
      el("button", { class: "button", onclick: () => window.print() }, "Print"),
    ]),
    el(
      "div",
      { class: "card" },
      report.vouchers.length === 0
        ? el("div", { class: "empty" }, "No vouchers on this date.")
        : el(
            "div",
            { class: "table-wrap" },
            el(
              "table",
              { class: "data" },
              el(
                "thead",
                {},
                el(
                  "tr",
                  {},
                  el("th", {}, "Voucher"),
                  el("th", {}, "Debit ledgers"),
                  el("th", {}, "Credit ledgers"),
                  el("th", { class: "num" }, "Amount"),
                ),
              ),
              el(
                "tbody",
                {},
                report.vouchers.map((voucher) =>
                  el(
                    "tr",
                    {},
                    el(
                      "td",
                      {},
                      el("div", { class: "mono" }, voucher.number),
                      el(
                        "div",
                        { class: "muted small" },
                        `${voucher.typeName}${voucher.party ? ` · ${voucher.party}` : ""}`,
                      ),
                    ),
                    el(
                      "td",
                      {},
                      voucher.debitLedgers.map((line) =>
                        el(
                          "div",
                          {},
                          `${line.ledger} `,
                          el(
                            "span",
                            { class: "muted small" },
                            fmt(line.amount),
                          ),
                        ),
                      ),
                    ),
                    el(
                      "td",
                      {},
                      voucher.creditLedgers.map((line) =>
                        el(
                          "div",
                          {},
                          `${line.ledger} `,
                          el(
                            "span",
                            { class: "muted small" },
                            fmt(line.amount),
                          ),
                        ),
                      ),
                    ),
                    el("td", { class: "num" }, fmt(voucher.total)),
                  ),
                ),
                el(
                  "tr",
                  { class: "total-row" },
                  el("td", {}, "Total"),
                  el("td", { class: "num" }, fmt(report.totals.debit)),
                  el("td", { class: "num" }, fmt(report.totals.credit)),
                  el("td", {}),
                ),
              ),
            ),
          ),
    ),
  );
}

async function renderLedgerReport(ledgerId) {
  const ledgers =
    state.ledgers.length > 0
      ? state.ledgers
      : (await api("/api/ledgers")).ledgers;
  state.ledgers = ledgers;
  const id = ledgerId ?? ledgers[0]?.id;
  if (id === undefined) {
    view.replaceChildren(
      el("div", { class: "card empty" }, "Create a ledger first."),
    );
    return;
  }
  const from = state.params.from ?? state.company.financialYearStart;
  const to = state.params.to ?? state.company.financialYearEnd;
  const report = await api(
    `/api/reports/ledger?ledgerId=${id}&from=${from}&to=${to}`,
  );

  const picker = el(
    "select",
    { onchange: (event) => navigate(`#/report/ledger/${event.target.value}`) },
    ledgers.map((ledger) =>
      el(
        "option",
        { value: ledger.id, selected: ledger.id === id },
        `${ledger.name} (${ledger.group})`,
      ),
    ),
  );

  view.replaceChildren(
    reportHead(
      `${report.ledger.name}`,
      `${report.ledger.group} · ${from} to ${to}`,
      [
        picker,
        el("input", {
          type: "date",
          value: from,
          onchange: (event) => setOverride("from", event.target.value),
        }),
        el("input", {
          type: "date",
          value: to,
          onchange: (event) => setOverride("to", event.target.value),
        }),
        el(
          "button",
          { class: "button", onclick: () => window.print() },
          "Print",
        ),
      ],
    ),
    el(
      "div",
      { class: "card" },
      el(
        "div",
        { class: "toolbar" },
        el(
          "span",
          { class: "badge neutral" },
          `Opening ${fmt(report.opening)} ${report.openingType}`,
        ),
        el(
          "span",
          { class: "badge ok" },
          `Closing ${fmt(report.closing)} ${report.closingType}`,
        ),
      ),
      el(
        "div",
        { class: "table-wrap" },
        el(
          "table",
          { class: "data" },
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              el("th", {}, "Date"),
              el("th", {}, "Voucher"),
              el("th", {}, "Particulars"),
              el("th", { class: "num" }, "Debit"),
              el("th", { class: "num" }, "Credit"),
              el("th", { class: "num" }, "Balance"),
            ),
          ),
          el(
            "tbody",
            {},
            el(
              "tr",
              { class: "subgroup-row" },
              el("td", {}, ""),
              el("td", {}, ""),
              el("td", {}, "Opening balance"),
              el("td", {}, ""),
              el("td", {}, ""),
              el("td", { class: "num" }, fmt(report.opening)),
            ),
            report.entries.map((entry) =>
              el(
                "tr",
                {},
                el("td", { class: "mono nowrap" }, entry.date),
                el(
                  "td",
                  {},
                  el("div", { class: "mono" }, entry.number),
                  el("div", { class: "muted small" }, entry.type),
                ),
                el("td", {}, entry.particulars || entry.narration || "—"),
                el(
                  "td",
                  { class: "num debit" },
                  entry.debit ? fmt(entry.debit) : "",
                ),
                el(
                  "td",
                  { class: "num credit" },
                  entry.credit ? fmt(entry.credit) : "",
                ),
                el("td", { class: "num" }, fmt(entry.balance)),
              ),
            ),
            el(
              "tr",
              { class: "total-row" },
              el("td", { colspan: "3" }, "Closing balance"),
              el("td", { class: "num" }, fmt(report.totals.debit)),
              el("td", { class: "num" }, fmt(report.totals.credit)),
              el(
                "td",
                { class: "num" },
                `${fmt(report.closing)} ${report.closingType}`,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

async function renderOutstanding() {
  const type = state.params.type === "payable" ? "payable" : "receivable";
  const asOf = state.params.asOf ?? state.company.financialYearEnd;
  const report = await api(
    `/api/reports/outstanding?type=${type}&asOf=${asOf}`,
  );
  view.replaceChildren(
    reportHead(
      type === "payable" ? "Bills Payable" : "Bills Receivable",
      `${report.group} · as on ${asOf}`,
      [
        el(
          "button",
          {
            class: "button",
            onclick: () =>
              setOverride(
                "type",
                type === "payable" ? "receivable" : "payable",
              ),
          },
          type === "payable" ? "Show receivables" : "Show payables",
        ),
        el("input", {
          type: "date",
          value: asOf,
          onchange: (event) => setOverride("asOf", event.target.value),
        }),
      ],
    ),
    el(
      "div",
      { class: "grid cols-4" },
      statCard(
        "Total",
        fmt(report.total),
        `${report.parties.length} parties`,
        "accent",
      ),
      statCard("0–30 days", fmt(report.ageing.current), "Current", "debit"),
      statCard(
        "31–90 days",
        fmt(Number(report.ageing.d30) + Number(report.ageing.d60)),
        "Watch closely",
        "debit",
      ),
      statCard(
        "Over 90 days",
        fmt(Number(report.ageing.d90) + Number(report.ageing.older)),
        "Follow up",
        "credit",
      ),
    ),
    el(
      "div",
      { class: "card", style: "margin-top:16px" },
      el(
        "div",
        { class: "table-wrap" },
        el(
          "table",
          { class: "data" },
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              el("th", {}, "Party"),
              el("th", { class: "num" }, "Balance"),
              el("th", {}, "Credit days"),
              el("th", {}, "Bills"),
            ),
          ),
          el(
            "tbody",
            {},
            report.parties.map((party) =>
              el(
                "tr",
                {},
                el("td", {}, party.name),
                el("td", { class: "num" }, fmt(party.balance)),
                el("td", {}, party.creditDays ?? "—"),
                el(
                  "td",
                  { class: "small muted" },
                  party.bills
                    .map(
                      (bill) =>
                        `${bill.number} · ${fmt(bill.amount)} · ${bill.ageDays}d`,
                    )
                    .join("  |  "),
                ),
              ),
            ),
            el(
              "tr",
              { class: "total-row" },
              el("td", {}, "Total"),
              el("td", { class: "num" }, fmt(report.total)),
              el("td", {}),
              el("td", {}),
            ),
          ),
        ),
      ),
    ),
  );
}

async function renderStockSummary() {
  const asOf = state.params.asOf ?? state.company.financialYearEnd;
  const report = await api(`/api/reports/stock-summary?asOf=${asOf}`);
  view.replaceChildren(
    reportHead("Stock Summary", `${report.company} · as on ${asOf}`, [
      el("input", {
        type: "date",
        value: asOf,
        onchange: (event) => setOverride("asOf", event.target.value),
      }),
      el("button", { class: "button", onclick: () => window.print() }, "Print"),
    ]),
    el(
      "div",
      { class: "card" },
      el(
        "div",
        { class: "table-wrap" },
        el(
          "table",
          { class: "data" },
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              el("th", {}, "Item"),
              el("th", {}, "Group"),
              el("th", { class: "num" }, "Opening"),
              el("th", { class: "num" }, "Inward"),
              el("th", { class: "num" }, "Outward"),
              el("th", { class: "num" }, "Closing"),
              el("th", { class: "num" }, "Rate"),
              el("th", { class: "num" }, "Value"),
            ),
          ),
          el(
            "tbody",
            {},
            report.rows.map((row) =>
              el(
                "tr",
                {},
                el("td", {}, row.name),
                el("td", { class: "muted" }, row.group ?? "—"),
                el("td", { class: "num" }, `${row.openingQty} ${row.unit}`),
                el("td", { class: "num" }, row.inwardQty),
                el("td", { class: "num" }, row.outwardQty),
                el("td", { class: "num" }, `${row.closingQty} ${row.unit}`),
                el("td", { class: "num" }, fmt(row.rate)),
                el("td", { class: "num" }, fmt(row.value)),
              ),
            ),
            el(
              "tr",
              { class: "total-row" },
              el("td", { colspan: "7" }, "Total closing value"),
              el("td", { class: "num" }, fmt(report.totalValue)),
            ),
          ),
        ),
      ),
      el(
        "p",
        { class: "muted small", style: "margin:12px 0 0" },
        "Valued at weighted average cost of opening stock and inward receipts. Stock-in-Hand is a reserved ledger group; inventory owns it.",
      ),
    ),
  );
}

async function renderGstSummary() {
  const from = state.params.from ?? state.company.financialYearStart;
  const to = state.params.to ?? state.company.financialYearEnd;
  const report = await api(`/api/reports/gst-summary?from=${from}&to=${to}`);
  view.replaceChildren(
    reportHead("GST Summary", `${from} to ${to}`, [
      el("input", {
        type: "date",
        value: from,
        onchange: (event) => setOverride("from", event.target.value),
      }),
      el("input", {
        type: "date",
        value: to,
        onchange: (event) => setOverride("to", event.target.value),
      }),
    ]),
    el(
      "div",
      { class: "grid cols-3" },
      statCard(
        "Output tax",
        fmt(report.outputTotal),
        "Collected on sales",
        "credit",
      ),
      statCard(
        "Input credit",
        fmt(report.inputTotal),
        "Paid on purchases",
        "debit",
      ),
      statCard(
        "Net payable",
        fmt(report.netPayable),
        "Before set-off adjustments",
        "accent",
      ),
    ),
    el(
      "div",
      { class: "card", style: "margin-top:16px" },
      el(
        "table",
        { class: "data" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", {}, "Ledger"),
            el("th", {}, "Head"),
            el("th", {}, "Kind"),
            el("th", { class: "num" }, "Amount"),
          ),
        ),
        el(
          "tbody",
          {},
          report.lines.map((line) =>
            el(
              "tr",
              {},
              el("td", {}, line.ledger),
              el("td", {}, line.tax),
              el("td", {}, line.kind === "output" ? "Output" : "Input credit"),
              el("td", { class: "num" }, fmt(line.amount)),
            ),
          ),
        ),
      ),
      el(
        "p",
        { class: "muted small", style: "margin:12px 0 0" },
        "Input credit is carried forward in the books; utilisation is a separate journal entry.",
      ),
    ),
  );
}

/* -------------------------------------------------------------------- data */

async function renderData() {
  const health = await api("/api/health");
  const dropzone = el(
    "div",
    { class: "dropzone", role: "button", tabindex: "0" },
    "Drop a Tally XML envelope here, or click to choose a file",
  );
  const fileInput = el("input", {
    type: "file",
    accept: ".xml,text/xml,application/xml",
    hidden: true,
  });

  const importFile = async (file) => {
    try {
      const text = await file.text();
      const result = await api("/api/import/xml", {
        method: "POST",
        body: text,
        headers: { "content-type": "application/xml" },
      });
      notify(
        `Imported ${result.ledgers} ledgers and ${result.vouchers} vouchers (${result.skipped} skipped)`,
        "ok",
      );
      if (result.warnings?.length) console.warn(result.warnings);
      render();
    } catch (error) {
      notify(error.message, "error");
    }
  };

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") fileInput.click();
  });
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () =>
    dropzone.classList.remove("dragover"),
  );
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
    const file = event.dataTransfer?.files?.[0];
    if (file) importFile(file);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) importFile(file);
  });

  view.replaceChildren(
    el(
      "div",
      { class: "page-head" },
      el(
        "div",
        {},
        el("h1", {}, "Data"),
        el("p", { class: "sub" }, "Interchange, backup and demo data"),
      ),
    ),
    el(
      "div",
      { class: "grid cols-2" },
      el(
        "div",
        { class: "card" },
        el("h2", {}, "Tally XML"),
        el(
          "p",
          { class: "muted small" },
          "Export masters and vouchers as a Tally envelope, or import one produced by Tally Prime. Debits are ISDEEMEDPOSITIVE with negative amounts, as Tally writes them.",
        ),
        el(
          "div",
          { style: "display:flex;gap:8px;flex-wrap:wrap;margin:12px 0" },
          el(
            "a",
            { class: "button primary", href: "/api/export/xml", download: "" },
            "Download XML",
          ),
          el(
            "a",
            { class: "button", href: "/api/export/xml?masters=false" },
            "Vouchers only",
          ),
        ),
        dropzone,
        fileInput,
      ),
      el(
        "div",
        { class: "card" },
        el("h2", {}, "Workspace"),
        el(
          "ul",
          { class: "list-plain" },
          el(
            "li",
            {},
            el("span", {}, "Company"),
            el("strong", {}, health.statistics?.company?.name ?? "—"),
          ),
          el(
            "li",
            {},
            el("span", {}, "Ledgers"),
            el(
              "strong",
              { class: "mono" },
              String(health.statistics?.counts?.ledgers ?? 0),
            ),
          ),
          el(
            "li",
            {},
            el("span", {}, "Vouchers"),
            el(
              "strong",
              { class: "mono" },
              String(health.statistics?.counts?.vouchers ?? 0),
            ),
          ),
          el(
            "li",
            {},
            el("span", {}, "Database"),
            el("strong", { class: "mono small" }, health.database),
          ),
        ),
        el(
          "div",
          { style: "margin-top:14px;display:flex;gap:8px;flex-wrap:wrap" },
          el(
            "button",
            {
              class: "button danger",
              onclick: async () => {
                if (
                  !confirm(
                    "Re-seed the demo company? Existing data is kept; seeding only runs on an empty book.",
                  )
                )
                  return;
                await api("/api/demo/reset", { method: "POST" });
                notify("Demo data loaded", "ok");
                render();
              },
            },
            "Load demo data",
          ),
        ),
        el("h3", { style: "margin-top:18px" }, "REST surface"),
        el(
          "div",
          { class: "code-block" },
          `GET  /api/reports/trial-balance?asOf=2026-10-24
GET  /api/reports/balance-sheet
GET  /api/reports/profit-loss?from=&to=
POST /api/vouchers
GET  /api/export/xml
POST /api/import/xml`,
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------------- modal */

function openModal(title, body, actions = []) {
  const root = document.getElementById("modal-root");
  const close = () => closeModal();
  const modal = el(
    "div",
    {
      class: "modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": title,
    },
    el(
      "header",
      {},
      el("h2", {}, title),
      el(
        "button",
        { class: "button ghost", onclick: close, "aria-label": "Close" },
        "✕",
      ),
    ),
    el("div", { class: "body" }, body),
    actions.length > 0 ? el("footer", {}, actions) : null,
  );
  const backdrop = el(
    "div",
    {
      class: "modal-backdrop",
      onclick: (event) => {
        if (event.target === backdrop) close();
      },
    },
    modal,
  );
  root.replaceChildren(backdrop);
  const focusable = modal.querySelector("input, select, textarea, button");
  focusable?.focus();
}

function closeModal() {
  document.getElementById("modal-root").replaceChildren();
}

function openHelp() {
  const rows = [
    ["F4 / F5 / F6", "Contra, Payment, Receipt voucher"],
    ["F7 / F8 / F9", "Journal, Sales, Purchase voucher"],
    ["Ctrl + A", "Accept the open voucher"],
    ["Esc", "Go back"],
    ["Alt + F1", "Toggle detailed and summary reports"],
    ["?", "This help"],
  ];
  openModal(
    "Keyboard shortcuts",
    el(
      "div",
      { class: "shortcut-grid" },
      rows.flatMap(([keys, description]) => [
        el("kbd", {}, keys),
        el("span", {}, description),
      ]),
    ),
    [el("button", { class: "button primary", onclick: closeModal }, "Got it")],
  );
}

/* --------------------------------------------------------------- shortcuts */

const VOUCHER_KEYS = {
  F4: "CONTRA",
  F5: "PAYMENT",
  F6: "RECEIPT",
  F7: "JOURNAL",
  F8: "SALES",
  F9: "PURCHASE",
};

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const typing =
    target instanceof HTMLElement &&
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);

  if (event.key === "Escape") {
    if (document.getElementById("modal-root").children.length > 0) {
      closeModal();
      event.preventDefault();
      return;
    }
    if (location.hash !== "#/gateway" && !typing) {
      history.back();
      event.preventDefault();
    }
    return;
  }

  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "a" &&
    state.screen === "voucher-new"
  ) {
    event.preventDefault();
    document.querySelector(".voucher-sheet .button.primary")?.click();
    return;
  }

  if (event.altKey && event.key === "F1") {
    event.preventDefault();
    state.detailed = !state.detailed;
    notify(state.detailed ? "Detailed reports" : "Summary reports", "info");
    render();
    return;
  }

  if (typing) return;

  const code = VOUCHER_KEYS[event.key];
  if (code !== undefined) {
    event.preventDefault();
    navigate(`#/voucher/new?type=${code}`);
    return;
  }

  if (event.key === "?") {
    event.preventDefault();
    openHelp();
  }
});

nav.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-nav]");
  if (button === null) return;
  const screen = button.dataset.nav;
  navigate(
    screen === "masters"
      ? "#/masters"
      : screen === "vouchers"
        ? "#/vouchers"
        : screen === "reports"
          ? "#/reports"
          : screen === "data"
            ? "#/data"
            : "#/gateway",
  );
});

window.addEventListener("hashchange", render);

/* -------------------------------------------------------------------- boot */

async function boot() {
  try {
    const [catalog, company] = await Promise.all([
      api("/api/catalog"),
      api("/api/company"),
    ]);
    state.catalog = catalog;
    state.company = company;
    paintHeader();
    document.getElementById("ticker").hidden = true;
    await render();
  } catch (error) {
    paintHeader();
    notify(error.message, "error");
    view.replaceChildren(
      el(
        "div",
        { class: "card" },
        el("h2", {}, "No company loaded"),
        el(
          "p",
          { class: "muted" },
          "Load the demo company to explore TallyCraft.",
        ),
        el(
          "button",
          {
            class: "button primary",
            onclick: async () => {
              await api("/api/demo/reset", { method: "POST" });
              location.reload();
            },
          },
          "Load demo company",
        ),
      ),
    );
  }
}

/* -------------------------------------------------------------- web app shell */

/*
 * Installable-app behaviour. None of this is required for the accounting
 * screens to work; it is what turns the page into an app: an install button
 * when the browser offers one, an honest connection pill, and a service
 * worker that keeps the last known book readable when the network drops.
 */

const installButton = document.getElementById("install-app");
const netStatus = document.getElementById("net-status");
let installPrompt = null;

if (installButton !== null) {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Keep the browser's mini-infobar out of the way and offer our own,
    // which sits in the header next to the company name.
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (installPrompt === null) {
      notify(
        "Use your browser menu → “Install app” / “Add to Home screen”.",
        "info",
      );
      return;
    }
    installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    installButton.hidden = true;
    if (choice?.outcome === "accepted") {
      notify("TallyCraft installed. Open it from your home screen.", "ok");
    }
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installButton.hidden = true;
  });

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (standalone) installButton.hidden = true;
}

/** Say it plainly when the browser has no network at all. */
function paintConnection() {
  if (netStatus === null) return;
  if (navigator.onLine) {
    netStatus.hidden = true;
    netStatus.textContent = "";
    return;
  }
  netStatus.hidden = false;
  netStatus.dataset.state = "offline";
  netStatus.textContent = "offline";
  netStatus.title =
    "No network. Showing the last copy this app saved on this device.";
}

window.addEventListener("offline", () => {
  paintConnection();
  notify(
    "You are offline. The last saved copy of the book stays readable.",
    "error",
  );
});

window.addEventListener("online", () => {
  paintConnection();
  notify("Back online.", "ok");
  // Refresh whatever screen is open with live numbers.
  render();
});

paintConnection();

/** Tell the operator that a newer shell is waiting, and let them take it. */
function announceUpdate(worker) {
  notify("A new version of TallyCraft is ready.", "info", {
    label: "Reload",
    run: () => {
      worker.postMessage("SKIP_WAITING");
      location.reload();
    },
  });
}

if (
  "serviceWorker" in navigator &&
  window.__TALLYCRAFT_DATA__ === undefined &&
  location.protocol.startsWith("http")
) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      if (registration.waiting !== null && navigator.serviceWorker.controller) {
        announceUpdate(registration.waiting);
      }
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (worker === null) return;
        worker.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller !== null
          ) {
            announceUpdate(worker);
          }
        });
      });
    } catch (error) {
      // No worker (private mode, unsupported browser, file://): the app is
      // fully functional without offline caching.
      console.warn("offline cache unavailable:", error.message);
    }
  });
}

boot();
