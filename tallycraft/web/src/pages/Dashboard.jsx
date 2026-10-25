/** Gateway: where the book stands, and the keys to move. */

import { useApi } from "../api.js";
import { Link } from "../link.jsx";
import { Badge, Card, Loading, Notice, Page, Stat, Table, ErrorNote } from "../components.jsx";
import { prettyDate, rupee } from "../format.js";
import { SHORTCUTS } from "../keys.js";
import { useApp } from "../App.jsx";

export default function Dashboard() {
  const { company, statistics, tick } = useApp();
  const trialBalance = useApi("/api/reports/trial-balance", [tick]);
  const recent = useApi("/api/vouchers?limit=8", [tick]);

  if (statistics === null) return <Loading label="Opening the books…" />;

  return (
    <Page
      title={`Gateway of TallyCraft`}
      subtitle={
        company
          ? `${company.name} · ${prettyDate(company.financialYearStart)} to ${prettyDate(company.financialYearEnd)} · GSTIN ${company.gstin ?? "—"}`
          : "Loading company…"
      }
      actions={
        <Link className="button primary" to="voucher/new?type=SALES">
          New sales voucher <kbd>F8</kbd>
        </Link>
      }
    >
      {trialBalance.error && <ErrorNote error={trialBalance.error} onRetry={trialBalance.reload} />}

      <div className="stats">
        <Stat label="Cash in hand" value={rupee(statistics.cashInHand)} hint="Cash-in-Hand group" />
        <Stat label="Bank balance" value={rupee(statistics.bankBalance)} hint="Bank Accounts group" />
        <Stat label="Debtors" value={rupee(statistics.debtors)} hint="Sundry Debtors" />
        <Stat label="Creditors" value={rupee(statistics.creditors)} hint="Sundry Creditors" />
        <Stat
          label="Net profit"
          value={rupee(statistics.netProfit)}
          hint="Current financial year"
          tone={statistics.netProfit >= 0 ? "good" : "bad"}
        />
      </div>

      <div className="grid two">
        <Card
          title="Books"
          subtitle="Masters and vouchers on file"
          actions={
            trialBalance.data && (
              <Badge tone={trialBalance.data.balanced ? "ok" : "bad"}>
                {trialBalance.data.balanced ? "Trial balance agrees" : `Out by ${rupee(trialBalance.data.difference)}`}
              </Badge>
            )
          }
        >
          <dl className="facts">
            <div>
              <dt>Ledgers</dt>
              <dd>{statistics.counts.ledgers}</dd>
            </div>
            <div>
              <dt>Vouchers</dt>
              <dd>{statistics.counts.vouchers}</dd>
            </div>
            <div>
              <dt>Groups</dt>
              <dd>{statistics.counts.groups}</dd>
            </div>
            <div>
              <dt>Stock items</dt>
              <dd>{statistics.counts.stockItems}</dd>
            </div>
          </dl>
          {trialBalance.data && (
            <p className="muted small">
              Debits {rupee(trialBalance.data.totals.debit)} · Credits{" "}
              {rupee(trialBalance.data.totals.credit)} · {trialBalance.data.ledgerCount} ledgers with
              balances on {prettyDate(trialBalance.data.asOf)}
            </p>
          )}
        </Card>

        <Card
          title="Vouchers"
          subtitle="Function keys work anywhere in the app"
        >
          <div className="keys">
            {SHORTCUTS.map((shortcut) => (
              <Link
                key={shortcut.keys}
                to={`voucher/new?type=${shortcut.type}`}
                className="key"
              >
                <kbd>{shortcut.keys.toUpperCase()}</kbd>
                <span>{shortcut.type.replaceAll("_", " ").toLowerCase()}</span>
              </Link>
            ))}
          </div>
          <div className="links">
            <Link to="day-book">Day book →</Link>
            <Link to="report/trial-balance">Trial balance →</Link>
            <Link to="report/balance-sheet">Balance sheet →</Link>
            <Link to="transfer">Tally XML →</Link>
          </div>
        </Card>
      </div>

      <Card
        title="Recent vouchers"
        subtitle="Newest by date and entry order"
        actions={<Link to="day-book">Open day book →</Link>}
      >
        {recent.loading && <Loading />}
        {recent.error && <Notice tone="bad">{recent.error.message}</Notice>}
        {recent.data && (
          <Table
            columns={[
              { key: "number", label: "Number" },
              { key: "date", label: "Date", render: (row) => prettyDate(row.date) },
              { key: "typeName", label: "Type" },
              {
                key: "particulars",
                label: "Particulars",
                render: (row) => row.party?.name ?? row.narration ?? <span className="muted">—</span>,
              },
              {
                key: "total",
                label: "Amount",
                align: "right",
                numeric: true,
                render: (row) => rupee(row.total),
              },
              {
                key: "open",
                label: "",
                align: "right",
                render: (row) => <Link to={`voucher/${row.id}`}>Open</Link>,
              },
            ]}
            rows={recent.data.vouchers}
            rowKey={(row) => row.id}
            empty="No vouchers yet."
          />
        )}
      </Card>
    </Page>
  );
}
