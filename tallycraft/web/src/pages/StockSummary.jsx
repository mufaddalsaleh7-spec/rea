/** Stock summary: periodic weighted average, valued at closing quantity. */

import { useState } from "react";
import { useApi } from "../api.js";
import { Card, ErrorNote, Loading, ReportHead, Table } from "../components.jsx";
import { money, prettyDate, qty, rupee } from "../format.js";
import { useApp } from "../App.jsx";

export default function StockSummary() {
  const { company } = useApp();
  const [asOf, setAsOf] = useState(company?.financialYearEnd ?? "");
  const report = useApi(`/api/reports/stock-summary?asOf=${asOf}`, [asOf]);

  if (report.loading) return <Loading label="Counting stock…" />;
  if (report.error) return <ErrorNote error={report.error} onRetry={report.reload} />;
  const data = report.data;

  return (
    <div className="page">
      <ReportHead
        title="Stock summary"
        subtitle={`${data.company} · as on ${prettyDate(data.asOf)}`}
        actions={<input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />}
      >
        <span className="stat-label">Closing value {rupee(data.totalValue)}</span>
      </ReportHead>

      <Card title="Items" subtitle="Weighted average, integer paise">
        <Table
          columns={[
            { key: "name", label: "Item" },
            { key: "group", label: "Stock group", render: (row) => row.group ?? "—" },
            { key: "unit", label: "Unit" },
            { key: "gstRate", label: "GST %", align: "right", numeric: true },
            { key: "openingQty", label: "Opening", align: "right", numeric: true, render: (row) => qty(row.openingQty) },
            { key: "inwardQty", label: "Inward", align: "right", numeric: true, render: (row) => qty(row.inwardQty) },
            { key: "outwardQty", label: "Outward", align: "right", numeric: true, render: (row) => qty(row.outwardQty) },
            { key: "closingQty", label: "Closing", align: "right", numeric: true, render: (row) => qty(row.closingQty) },
            { key: "rate", label: "Rate", align: "right", numeric: true, render: (row) => money(row.rate) },
            { key: "value", label: "Value", align: "right", numeric: true, render: (row) => money(row.value) },
          ]}
          rows={data.rows}
          rowKey={(row) => row.id}
          footer={
            <tr className="total-row">
              <td colSpan={9}>Total closing value</td>
              <td className="align-right num">{money(data.totalValue)}</td>
            </tr>
          }
          empty="No stock items yet."
        />
      </Card>
    </div>
  );
}
