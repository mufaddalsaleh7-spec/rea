/** Profit & loss: direct and indirect sections, gross and net. */

import { useState } from "react";
import { useApi } from "../api.js";
import { Badge, Card, ErrorNote, Loading, ReportHead } from "../components.jsx";
import { money, prettyDate, rupee } from "../format.js";
import { useApp } from "../App.jsx";

function SectionCard({ section }) {
  return (
    <Card title={section.name} subtitle={`Total ${rupee(section.total)}`}>
      <table className="sheet">
        <tbody>
          {section.rows.length === 0 && (
            <tr>
              <td className="muted">No balances</td>
              <td className="num muted">—</td>
            </tr>
          )}
          {section.rows.map((row) => (
            <FragmentRow key={row.name} row={row} />
          ))}
        </tbody>
        <tfoot>
          <tr className="total-row">
            <td>Total</td>
            <td className="num">{money(section.total)}</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

function FragmentRow({ row }) {
  return (
    <>
      <tr className="group-row">
        <th>{row.name}</th>
        <td className="num">{money(row.amount)}</td>
      </tr>
      {row.groups.map((group) => (
        <tr key={`${row.name}-${group.name}`}>
          <td className="indent-1">{group.name}</td>
          <td className="num">{money(group.amount)}</td>
        </tr>
      ))}
      {row.ledgers
        .filter((ledger) => ledger.amount !== 0)
        .map((ledger) => (
          <tr key={`${row.name}-${ledger.name}`}>
            <td className="indent-2">{ledger.name}</td>
            <td className="num">{money(ledger.amount)}</td>
          </tr>
        ))}
    </>
  );
}

export default function ProfitLoss() {
  const { company } = useApp();
  const [from, setFrom] = useState(company?.financialYearStart ?? "");
  const [to, setTo] = useState(company?.financialYearEnd ?? "");
  const report = useApi(`/api/reports/profit-loss?from=${from}&to=${to}`, [from, to]);

  if (report.loading) return <Loading label="Closing the year…" />;
  if (report.error) return <ErrorNote error={report.error} onRetry={report.reload} />;
  const data = report.data;

  return (
    <div className="page">
      <ReportHead
        title="Profit & loss account"
        subtitle={`${data.company} · ${prettyDate(data.from)} to ${prettyDate(data.to)}`}
        actions={
          <>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </>
        }
      >
        <Badge tone={data.netProfit >= 0 ? "ok" : "bad"}>
          {data.isLoss ? "Loss" : "Profit"} {rupee(Math.abs(data.netProfit))}
        </Badge>
      </ReportHead>

      <div className="stats compact">
        <div className="stat">
          <span className="stat-label">Gross profit</span>
          <strong>{rupee(data.grossProfit)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Net profit</span>
          <strong className={data.netProfit >= 0 ? "good" : "bad"}>{rupee(data.netProfit)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Opening stock</span>
          <strong>{rupee(data.stock.opening)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Closing stock</span>
          <strong>{rupee(data.stock.closing)}</strong>
        </div>
      </div>

      <div className="grid two">
        <SectionCard section={data.directExpense} />
        <SectionCard section={data.directIncome} />
        <SectionCard section={data.indirectExpense} />
        <SectionCard section={data.indirectIncome} />
      </div>
    </div>
  );
}
