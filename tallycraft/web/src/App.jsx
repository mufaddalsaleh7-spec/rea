/**
 * Shell, navigation and screen switch.
 *
 * Company, catalogue and headline figures load once here; any screen that
 * writes calls `refresh()`, which re-reads them and bumps `tick` so the open
 * report reloads too. That is the whole state story — the book is the state.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, useApi } from "./api.js";
import { rupee } from "./format.js";
import { SHORTCUTS, matchShortcut } from "./keys.js";
import { navigate, useRoute } from "./router.js";
import { Link } from "./link.jsx";
import { Badge, Loading } from "./components.jsx";

import Dashboard from "./pages/Dashboard.jsx";
import VoucherEntry from "./pages/VoucherEntry.jsx";
import VoucherView from "./pages/VoucherView.jsx";
import DayBook from "./pages/DayBook.jsx";
import Ledgers from "./pages/Ledgers.jsx";
import LedgerStatement from "./pages/LedgerStatement.jsx";
import TrialBalance from "./pages/TrialBalance.jsx";
import BalanceSheet from "./pages/BalanceSheet.jsx";
import ProfitLoss from "./pages/ProfitLoss.jsx";
import Outstanding from "./pages/Outstanding.jsx";
import GstSummary from "./pages/GstSummary.jsx";
import StockSummary from "./pages/StockSummary.jsx";
import Transfer from "./pages/Transfer.jsx";
import NotFound from "./pages/NotFound.jsx";

const AppContext = createContext(null);

export function useApp() {
  return useContext(AppContext);
}

const NAV = [
  {
    section: "Gateway",
    items: [{ label: "Gateway of TallyCraft", to: "gateway", key: "gateway" }],
  },
  {
    section: "Vouchers",
    items: SHORTCUTS.map((shortcut) => ({
      label: `${shortcut.type.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}`,
      to: `voucher/new?type=${shortcut.type}`,
      key: `new-${shortcut.type}`,
      hint: shortcut.keys.toUpperCase(),
    })),
  },
  {
    section: "Reports",
    items: [
      { label: "Day book", to: "day-book", key: "day-book" },
      { label: "Trial balance", to: "report/trial-balance", key: "trial-balance" },
      { label: "Profit & loss", to: "report/profit-loss", key: "profit-loss" },
      { label: "Balance sheet", to: "report/balance-sheet", key: "balance-sheet" },
      { label: "Outstanding", to: "report/outstanding", key: "outstanding" },
      { label: "GST summary", to: "report/gst-summary", key: "gst" },
      { label: "Stock summary", to: "report/stock-summary", key: "stock" },
    ],
  },
  {
    section: "Masters",
    items: [
      { label: "Ledgers", to: "ledgers", key: "ledgers" },
      { label: "Import / export", to: "transfer", key: "transfer" },
    ],
  },
];

export default function App() {
  const route = useRoute();
  const [tick, setTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const catalog = useApi("/api/catalog");
  const company = useApi("/api/company");
  const statistics = useApi("/api/statistics", [tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  // Reload the headline figures whenever a screen writes.
  useEffect(() => {
    if (tick > 0) {
      company.reload();
      catalog.reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // Function keys post vouchers from anywhere, like Tally.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.defaultPrevented) return;
      const shortcut = matchShortcut(event);
      if (shortcut) {
        event.preventDefault();
        navigate("voucher/new", { type: shortcut.type });
        return;
      }
      if (event.key === "Escape") setMenuOpen(false);
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, []);

  const context = {
    catalog: catalog.data,
    company: company.data,
    statistics: statistics.data,
    tick,
    refresh,
  };

  const active = route.segments[0] ?? "gateway";

  return (
    <AppContext.Provider value={context}>
      <div className="shell">
        <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
          <Link to="gateway" className="brand" onClick={() => setMenuOpen(false)}>
            <span className="brand-mark">T</span>
            <span>
              <strong>TallyCraft</strong>
              <small>{company.data?.name ?? "Loading company…"}</small>
            </span>
          </Link>

          <nav>
            {NAV.map((group) => (
              <div key={group.section} className="nav-group">
                <p className="nav-label">{group.section}</p>
                {group.items.map((item) => {
                  const target = item.to.split("?")[0];
                  const on = active === target || (target === "gateway" && active === "gateway");
                  return (
                    <Link
                      key={item.key}
                      to={item.to}
                      className={`nav-item ${on ? "active" : ""}`}
                      onClick={() => setMenuOpen(false)}
                    >
                      <span>{item.label}</span>
                      {item.hint && <kbd>{item.hint}</kbd>}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <footer className="sidebar-foot">
            <span className="muted">Net profit</span>
            <strong>
              {statistics.data ? rupee(statistics.data.netProfit) : "—"}
            </strong>
            <span className="muted small">
              {statistics.data
                ? `${statistics.data.counts.vouchers} vouchers · ${statistics.data.counts.ledgers} ledgers`
                : "double-entry, integer paise"}
            </span>
          </footer>
        </aside>

        <main className="workspace">
          <header className="mobile-bar">
            <button className="button ghost" onClick={() => setMenuOpen((open) => !open)}>
              ☰ Menu
            </button>
            <strong>TallyCraft</strong>
            <Badge tone="ok">PHP + React</Badge>
          </header>

          {catalog.error && (
            <div className="notice bad">
              <strong>Backend unreachable</strong>
              <p>{catalog.error.message}</p>
            </div>
          )}

          <Screen route={route} />
        </main>
      </div>
    </AppContext.Provider>
  );
}

function Screen({ route }) {
  const [first, second] = route.segments;

  if (first === undefined || first === "gateway") return <Dashboard />;

  if (first === "voucher") {
    if (second === "new") return <VoucherEntry route={route} />;
    if (second !== undefined) return <VoucherView route={route} />;
  }
  if (first === "day-book") return <DayBook route={route} />;
  if (first === "ledgers") return <Ledgers route={route} />;
  if (first === "ledger" && second !== undefined) {
    return <LedgerStatement route={route} ledgerId={Number(second)} />;
  }
  if (first === "report") {
    if (second === "trial-balance") return <TrialBalance route={route} />;
    if (second === "balance-sheet") return <BalanceSheet route={route} />;
    if (second === "profit-loss") return <ProfitLoss route={route} />;
    if (second === "outstanding") return <Outstanding route={route} />;
    if (second === "gst-summary") return <GstSummary route={route} />;
    if (second === "stock-summary") return <StockSummary route={route} />;
  }
  if (first === "transfer") return <Transfer />;

  return <NotFound route={route} />;
}
