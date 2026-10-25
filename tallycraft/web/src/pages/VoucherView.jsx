/** A single voucher, readable and printable, with a guarded delete. */

import { useState } from "react";
import { api, useApi } from "../api.js";
import { Link } from "../link.jsx";
import { Badge, Button, Card, ErrorNote, Loading, Notice, Page, Table } from "../components.jsx";
import { money, prettyDate, qty, rupee } from "../format.js";
import { navigate } from "../router.js";
import { useApp } from "../App.jsx";

export default function VoucherView({ route }) {
  const id = Number(route.segments[1]);
  const { refresh } = useApp();
  const voucher = useApi(`/api/vouchers/${id}`, [id]);
  const [error, setError] = useState(null);

  async function remove() {
    if (!globalThis.confirm("Delete this voucher? The double entry is reversed out of every report.")) return;
    try {
      await api(`/api/vouchers/${id}`, { method: "DELETE" });
      refresh();
      navigate("day-book", { date: voucher.data?.date });
    } catch (failure) {
      setError(failure);
    }
  }

  if (voucher.loading) return <Loading label="Loading voucher…" />;
  if (voucher.error) return <ErrorNote error={voucher.error} onRetry={voucher.reload} />;
  const entry = voucher.data;

  const debitTotal = entry.lines.reduce((sum, line) => sum + line.debit, 0);
  const creditTotal = entry.lines.reduce((sum, line) => sum + line.credit, 0);

  return (
    <Page
      title={`${entry.typeName} ${entry.number}`}
      subtitle={`${prettyDate(entry.date)}${entry.party ? ` · ${entry.party.name}` : ""}`}
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate("day-book", { date: entry.date })}>
            Day book
          </Button>
          <Button variant="danger" onClick={remove}>
            Delete
          </Button>
        </>
      }
    >
      {error && <ErrorNote error={error} />}
      {entry.narration && <Notice tone="info">{entry.narration}</Notice>}

      <Card title="Double entry" subtitle={`Total ${rupee(entry.total)}`}>
        <Table
          columns={[
            { key: "ledger", label: "Ledger" },
            { key: "group", label: "Group" },
            { key: "debit", label: "Debit", align: "right", numeric: true, render: (row) => (row.debit > 0 ? money(row.debit) : "") },
            { key: "credit", label: "Credit", align: "right", numeric: true, render: (row) => (row.credit > 0 ? money(row.credit) : "") },
            { key: "billRef", label: "Bill ref", render: (row) => row.billRef ?? "—" },
          ]}
          rows={entry.lines}
          footer={
            <tr className="total-row">
              <td colSpan={2}>Total</td>
              <td className="align-right num">{money(debitTotal)}</td>
              <td className="align-right num">{money(creditTotal)}</td>
              <td />
            </tr>
          }
        />
      </Card>

      {entry.inventory?.length > 0 && (
        <Card title="Inventory" subtitle="Stock moved by this voucher">
          <Table
            columns={[
              { key: "item", label: "Item" },
              { key: "quantity", label: "Quantity", align: "right", numeric: true, render: (row) => qty(row.quantity) },
              { key: "unit", label: "Unit" },
              { key: "rate", label: "Rate", align: "right", numeric: true, render: (row) => money(row.rate) },
              { key: "amount", label: "Value", align: "right", numeric: true, render: (row) => rupee(row.amount) },
            ]}
            rows={entry.inventory}
            rowKey={(row) => `${row.item}-${row.quantity}`}
          />
        </Card>
      )}

      <p className="muted small">
        <Badge tone={entry.type === "SALES" ? "ok" : "neutral"}>{entry.type}</Badge>{" "}
        {entry.reference ? `Reference ${entry.reference}` : "No reference"}
      </p>
      <p className="muted small">
        <Link to="ledgers">Back to ledgers</Link> · <Link to="report/trial-balance">Trial balance</Link>
      </p>
    </Page>
  );
}
