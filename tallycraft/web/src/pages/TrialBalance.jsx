/** Trial balance: every group and ledger with a balance, Dr and Cr columns. */

import { useState } from "react";
import { useApi } from "../api.js";
import { Badge, Card, ErrorNote, Loading, ReportHead, Table } from "../components.jsx";
import { money, prettyDate, rupee } from "../format.js";
import { useApp } from "../App.jsx";

export default function TrialBalance() {
  const { company } = useApp();
  const [asOf, setAsOf] = useState(company?.financialYearEnd ?? "");
  const [detailed, setDetailed] = useState(true);
  const query = new URLSearchParams();
  if (asOf) query.set("asOf", asOf);
  query.set("detailed", String(detailed));
  const report = useApi(`/api/reports/trial-balance?${query}`, [asOf, detailed]);

  if (report.loading) return <Loading label="Adding up the book…" />;
  if (report.error) return <ErrorNote error={report.error} onRetry={report.reload} />;
  const data = report.data;

  return (
    <div className="page">
      <ReportHead
        title="Trial balance"
        subtitle={`${data.company} · as on ${prettyDate(data.asOf)}`}
        actions={
          <>
            <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
            <label className="inline-check">
              <input type="checkbox" checked={detailed} onChange={(event) => setDetailed(event.target.checked)} />
              Ledger detail
            </label>
          </>
        }
      >
        <Badge tone={data.balanced ? "ok" : "bad"}>
          {data.balanced ? "Balanced" : `Difference ${rupee(data.difference)}`}
        </Badge>
      </ReportHead>

      <Card title="Balances" subtitle={`${data.rows.length} rows · ${data.ledgerCount} ledgers`}>
        <Table
          columns={[
            {
              key: "name",
              label: "Particulars",
              render: (row) => (
                <span className={row.kind === "group" ? "group-name" : "ledger-name"} style={{ paddingLeft: `${(row.depth ?? 0) * 16}px` }}>
                  {row.name}
                </span>
              ),
            },
            {
              key: "debit",
              label: "Debit",
              align: "right",
              numeric: true,
              render: (row) => (row.debit ? money(row.debit) : ""),
            },
            {
              key: "credit",
              label: "Credit",
              align: "right",
              numeric: true,
              render: (row) => (row.credit ? money(row.credit) : ""),
            },
          ]}
          rows={data.rows}
          rowKey={(row) => `${row.kind}-${row.name}`}
          footer={
            <tr className="total-row">
              <td>Total</td>
              <td className="align-right num">{money(data.totals.debit)}</td>
              <td className="align-right num">{money(data.totals.credit)}</td>
            </tr>
          }
        />
      </Card>
    </div>
  );
}
