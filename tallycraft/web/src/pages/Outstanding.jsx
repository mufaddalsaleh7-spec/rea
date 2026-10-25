/** Outstanding: ageing by party, receivable or payable. */

import { useState } from "react";
import { useApi } from "../api.js";
import { Link } from "../link.jsx";
import { Badge, Card, ErrorNote, Loading, ReportHead, Table } from "../components.jsx";
import { money, prettyDate, rupee } from "../format.js";
import { useApp } from "../App.jsx";

const BUCKETS = [
  { key: "current", label: "0–30 days" },
  { key: "d30", label: "31–60 days" },
  { key: "d60", label: "61–90 days" },
  { key: "d90", label: "91–180 days" },
  { key: "older", label: "Over 180 days" },
];

/** Per-party ageing, read from the bills the backend already aged. */
function partyBuckets(party) {
  const sums = { current: 0, d30: 0, d60: 0, d90: 0, older: 0 };
  for (const bill of party.bills) sums[bill.bucket] += bill.amount;
  return sums;
}

export default function Outstanding() {
  const { company } = useApp();
  const [asOf, setAsOf] = useState(company?.financialYearEnd ?? "");
  const [type, setType] = useState("receivable");
  const [open, setOpen] = useState(null);
  const report = useApi(`/api/reports/outstanding?asOf=${asOf}&type=${type}`, [asOf, type]);

  if (report.loading) return <Loading label="Ageing the balances…" />;
  if (report.error) return <ErrorNote error={report.error} onRetry={report.reload} />;
  const data = report.data;
  const selected = data.parties.find((party) => party.id === open) ?? data.parties[0] ?? null;

  return (
    <div className="page">
      <ReportHead
        title={type === "payable" ? "Outstanding payables" : "Outstanding receivables"}
        subtitle={`${data.group} · as on ${prettyDate(data.asOf)}`}
        actions={
          <>
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="receivable">Receivable</option>
              <option value="payable">Payable</option>
            </select>
            <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
          </>
        }
      >
        <Badge tone={data.total > 0 ? "warn" : "ok"}>Total {rupee(data.total)}</Badge>
      </ReportHead>

      <div className="stats compact">
        {BUCKETS.map((bucket) => (
          <div className="stat" key={bucket.key}>
            <span className="stat-label">{bucket.label}</span>
            <strong>{rupee(data.ageing[bucket.key] ?? 0)}</strong>
          </div>
        ))}
      </div>

      <Card title="By party" subtitle="Click a row to see the bills behind the balance">
        <Table
          columns={[
            {
              key: "name",
              label: "Party",
              render: (row) => (
                <button className="linkish" onClick={() => setOpen(row.id)}>
                  {row.name}
                </button>
              ),
            },
            { key: "creditDays", label: "Credit days", align: "right", render: (row) => row.creditDays ?? "—" },
            ...BUCKETS.map((bucket) => ({
              key: bucket.key,
              label: bucket.label,
              align: "right",
              numeric: true,
              render: (row) => {
                const value = partyBuckets(row)[bucket.key];
                return value === 0 ? "" : money(value);
              },
            })),
            { key: "balance", label: "Balance", align: "right", numeric: true, render: (row) => money(row.balance) },
          ]}
          rows={data.parties}
          rowKey={(row) => row.id}
          footer={
            <tr className="total-row">
              <td colSpan={2}>Total</td>
              {BUCKETS.map((bucket) => (
                <td key={bucket.key} className="align-right num">
                  {money(data.ageing[bucket.key] ?? 0)}
                </td>
              ))}
              <td className="align-right num">{money(data.total)}</td>
            </tr>
          }
          empty="Nothing outstanding — every bill is settled."
        />
      </Card>

      {selected && (
        <Card title={`${selected.name} · bills`} subtitle={`Balance ${rupee(selected.balance)}`}>
          <Table
            columns={[
              { key: "date", label: "Date", render: (row) => prettyDate(row.date) },
              { key: "number", label: "Voucher" },
              { key: "type", label: "Type" },
              { key: "billRef", label: "Bill ref", render: (row) => row.billRef ?? "—" },
              { key: "ageDays", label: "Age (days)", align: "right", numeric: true },
              { key: "bucket", label: "Bucket", render: (row) => <Badge tone="neutral">{row.bucket}</Badge> },
              { key: "amount", label: "Amount", align: "right", numeric: true, render: (row) => money(row.amount) },
            ]}
            rows={selected.bills}
            rowKey={(row) => `${row.number}-${row.date}-${row.amount}`}
          />
        </Card>
      )}

      <p className="muted small">
        <Link to="report/gst-summary">GST summary →</Link>
      </p>
    </div>
  );
}
