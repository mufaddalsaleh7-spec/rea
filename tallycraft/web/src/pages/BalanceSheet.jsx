/** Balance sheet: two columns, inventory replaces the stock ledger. */

import { useState } from "react";
import { useApi } from "../api.js";
import { Badge, Card, ErrorNote, Loading, Notice, ReportHead } from "../components.jsx";
import { money, prettyDate, rupee } from "../format.js";
import { useApp } from "../App.jsx";

function Section({ title, rows, extra, total }) {
  return (
    <Card title={title} subtitle={`Total ${rupee(total)}`}>
      <table className="sheet">
        <tbody>
          {rows.map((row) => (
            <SheetRow key={row.name} row={row} />
          ))}
          {extra?.map((row) => (
            <tr key={row.name} className="group-row">
              <th>{row.name}</th>
              <td className="num">
                {money(row.amount)} {row.isLoss ? <span className="muted">(loss)</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="total-row">
            <td>Total</td>
            <td className="num">{money(total)}</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

function SheetRow({ row }) {
  return (
    <>
      <tr className="group-row">
        <th>{row.name}</th>
        <td className="num">{money(row.amount)}</td>
      </tr>
      {row.groups.map((group) => (
        <tr key={`${row.name}-${group.name}`} className="subgroup-row">
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
      {row.groups.flatMap((group) =>
        group.ledgers
          .filter((ledger) => ledger.amount !== 0)
          .map((ledger) => (
            <tr key={`${row.name}-${group.name}-${ledger.name}`}>
              <td className="indent-2">{ledger.name}</td>
              <td className="num">{money(ledger.amount)}</td>
            </tr>
          )),
      )}
    </>
  );
}

export default function BalanceSheet() {
  const { company } = useApp();
  const [asOf, setAsOf] = useState(company?.financialYearEnd ?? "");
  const report = useApi(`/api/reports/balance-sheet?asOf=${asOf}`, [asOf]);

  if (report.loading) return <Loading label="Building the balance sheet…" />;
  if (report.error) return <ErrorNote error={report.error} onRetry={report.reload} />;
  const data = report.data;

  return (
    <div className="page">
      <ReportHead
        title="Balance sheet"
        subtitle={`${data.company} · as on ${prettyDate(data.asOf)}`}
        actions={<input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />}
      >
        <Badge tone={data.balanced ? "ok" : "bad"}>
          {data.balanced ? "Assets equal liabilities" : `Difference ${rupee(data.difference)}`}
        </Badge>
        <Badge tone="neutral">Closing stock {rupee(data.stock.closing)}</Badge>
      </ReportHead>

      <div className="grid two">
        <Section
          title="Liabilities"
          rows={data.liabilities}
          extra={[{ name: "Profit & Loss A/c", amount: data.profitAndLoss.amount, isLoss: data.profitAndLoss.isLoss }]}
          total={data.totals.liabilities}
        />
        <Section title="Assets" rows={data.assets} total={data.totals.assets} />
      </div>

      <Notice tone="info" title="Inventory valuation">
        Stock on the books {rupee(data.stock.onBooks)} is replaced by the closing stock{" "}
        {rupee(data.stock.closing)}; the movement lands in the P&L, which is why the two sides
        still agree.
      </Notice>
    </div>
  );
}
