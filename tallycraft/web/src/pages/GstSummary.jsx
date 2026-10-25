/** GST summary: output tax, input credit, net payable. */

import { useState } from "react";
import { useApi } from "../api.js";
import { Badge, Card, ErrorNote, Loading, ReportHead, Table } from "../components.jsx";
import { money, prettyDate, rupee } from "../format.js";
import { useApp } from "../App.jsx";

export default function GstSummary() {
  const { company } = useApp();
  const [from, setFrom] = useState(company?.financialYearStart ?? "");
  const [to, setTo] = useState(company?.financialYearEnd ?? "");
  const report = useApi(`/api/reports/gst-summary?from=${from}&to=${to}`, [from, to]);

  if (report.loading) return <Loading label="Reading the tax ledgers…" />;
  if (report.error) return <ErrorNote error={report.error} onRetry={report.reload} />;
  const data = report.data;
  const output = data.lines.filter((line) => line.kind === "output");
  const input = data.lines.filter((line) => line.kind === "input");

  return (
    <div className="page">
      <ReportHead
        title="GST summary"
        subtitle={`${prettyDate(data.from)} to ${prettyDate(data.to)}`}
        actions={
          <>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </>
        }
      >
        <Badge tone={data.netPayable >= 0 ? "warn" : "ok"}>
          {data.netPayable >= 0 ? "Payable" : "Refundable"} {rupee(Math.abs(data.netPayable))}
        </Badge>
      </ReportHead>

      <div className="stats compact">
        <div className="stat">
          <span className="stat-label">Output tax</span>
          <strong>{rupee(data.outputTotal)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Input credit</span>
          <strong>{rupee(data.inputTotal)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Net payable</span>
          <strong className={data.netPayable > 0 ? "bad" : "good"}>{rupee(data.netPayable)}</strong>
        </div>
      </div>

      <div className="grid two">
        <Card title="Output tax" subtitle="Collected on sales">
          <Table
            columns={[
              { key: "ledger", label: "Ledger" },
              { key: "tax", label: "Tax" },
              { key: "amount", label: "Amount", align: "right", numeric: true, render: (row) => money(row.amount) },
            ]}
            rows={output}
            rowKey={(row) => row.ledger}
            empty="No output tax in this period."
          />
        </Card>
        <Card title="Input credit" subtitle="Paid on purchases">
          <Table
            columns={[
              { key: "ledger", label: "Ledger" },
              { key: "tax", label: "Tax" },
              { key: "amount", label: "Amount", align: "right", numeric: true, render: (row) => money(row.amount) },
            ]}
            rows={input}
            rowKey={(row) => row.ledger}
            empty="No input credit in this period."
          />
        </Card>
      </div>
    </div>
  );
}
