/** One ledger, every entry, with a running balance in Dr/Cr. */

import { useState } from "react";
import { useApi } from "../api.js";
import { Link } from "../link.jsx";
import { Badge, ErrorNote, Loading, Notice, ReportHead, Table, Card } from "../components.jsx";
import { money, prettyDate, drcr } from "../format.js";
import { useApp } from "../App.jsx";

export default function LedgerStatement({ ledgerId }) {
  const { company } = useApp();
  const [from, setFrom] = useState(company?.financialYearStart ?? "");
  const [to, setTo] = useState(company?.financialYearEnd ?? "");
  const query = new URLSearchParams({ ledgerId: String(ledgerId) });
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const statement = useApi(`/api/reports/ledger?${query}`, [ledgerId, from, to]);

  if (statement.loading) return <Loading label="Opening the ledger…" />;
  if (statement.error) return <ErrorNote error={statement.error} onRetry={statement.reload} />;
  const report = statement.data;

  return (
    <div className="page">
      <ReportHead
        title={report.ledger.name}
        subtitle={`${report.ledger.group} · ${prettyDate(report.from)} to ${prettyDate(report.to)}`}
        actions={
          <>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </>
        }
      />

      <div className="stats compact">
        <div className="stat">
          <span className="stat-label">Opening</span>
          <strong>{drcr(report.opening * (report.openingType === "Cr" ? -1 : 1))}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Debits</span>
          <strong>{money(report.totals.debit)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Credits</span>
          <strong>{money(report.totals.credit)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Closing</span>
          <strong>{drcr(report.closing * (report.closingType === "Cr" ? -1 : 1))}</strong>
        </div>
      </div>

      <Card title="Statement" subtitle={`${report.entries.length} entries`}>
        <Table
          columns={[
            { key: "date", label: "Date", render: (row) => prettyDate(row.date) },
            { key: "number", label: "Voucher", render: (row) => <Link to={`voucher/${row.voucherId}`}>{row.number}</Link> },
            { key: "type", label: "Type" },
            { key: "particulars", label: "Particulars" },
            { key: "billRef", label: "Bill", render: (row) => row.billRef ?? "—" },
            { key: "debit", label: "Debit", align: "right", numeric: true, render: (row) => (row.debit ? money(row.debit) : "") },
            { key: "credit", label: "Credit", align: "right", numeric: true, render: (row) => (row.credit ? money(row.credit) : "") },
            { key: "balance", label: "Balance", align: "right", numeric: true, render: (row) => drcr(row.balance) },
          ]}
          rows={report.entries}
          footer={
            <tr className="total-row">
              <td colSpan={5}>Total</td>
              <td className="align-right num">{money(report.totals.debit)}</td>
              <td className="align-right num">{money(report.totals.credit)}</td>
              <td className="align-right num">{drcr(report.closing)}</td>
            </tr>
          }
          empty="No entries in this period."
        />
      </Card>

      {report.entries.length === 0 && (
        <Notice tone="info">This ledger has no movement in the chosen window; only the opening balance applies.</Notice>
      )}
      <p className="muted small">
        <Link to="ledgers">All ledgers</Link> · <Badge tone="neutral">{report.ledger.group}</Badge>
      </p>
    </div>
  );
}
