/**
 * Voucher entry.
 *
 * One form for all eight voucher types: the type decides the numbering, the
 * ledger groups it expects, and whether stock lines are allowed. Debits and
 * credits are typed as people say them ("1,23,456.78", "500 Dr"), and the
 * difference line tells you what is still missing before you press Save.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { api, useApi } from "../api.js";
import { Button, Card, ErrorNote, Field, Loading, Notice, Page, Table } from "../components.jsx";
import { money, rupee, today } from "../format.js";
import { navigate } from "../router.js";
import { useApp } from "../App.jsx";

const STOCK_TYPES = new Set(["SALES", "PURCHASE", "CREDIT_NOTE", "DEBIT_NOTE"]);

let lineKey = 0;
const blankLine = () => ({ key: (lineKey += 1), ledger: "", side: "Dr", amount: "" });

export default function VoucherEntry({ route }) {
  const { catalog, refresh } = useApp();
  const type = route.params.type ?? "JOURNAL";
  const definition = catalog?.voucherTypes.find((entry) => entry.code === type) ?? null;

  const [date, setDate] = useState(route.params.date ?? today());
  const [party, setParty] = useState("");
  const [narration, setNarration] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState(() => [blankLine(), blankLine()]);
  const [inventory, setInventory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState(null);
  const firstInput = useRef(null);

  const ledgers = useApi("/api/ledgers");
  const stockItems = useApi("/api/stock-items");
  const nextNumber = useApi(
    `/api/vouchers/next?type=${encodeURIComponent(type)}&date=${date}`,
    [type, date],
  );

  useEffect(() => {
    firstInput.current?.focus();
  }, [type]);

  const ledgerRows = ledgers.data?.ledgers ?? [];
  const itemRows = stockItems.data?.rows ?? [];
  const itemNames = itemRows.map((item) => item.name);
  const byName = useMemo(
    () => new Map(ledgerRows.map((ledger) => [ledger.name, ledger])),
    [ledgerRows],
  );

  const parsed = lines.map((line) => ({
    ...line,
    ledgerRow: byName.get(line.ledger) ?? null,
    value: Number(String(line.amount).replaceAll(",", "")) || 0,
  }));

  const debitTotal = parsed
    .filter((line) => line.side === "Dr")
    .reduce((sum, line) => sum + line.value, 0);
  const creditTotal = parsed
    .filter((line) => line.side === "Cr")
    .reduce((sum, line) => sum + line.value, 0);
  const difference = Math.round((debitTotal - creditTotal) * 100) / 100;

  const setLine = (index, patch) => {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    );
  };

  const addLine = () => setLines((current) => [...current, blankLine()]);
  const removeLine = (index) =>
    setLines((current) =>
      current.length <= 2 ? current : current.filter((_, position) => position !== index),
    );

  const addInventory = () =>
    setInventory((current) => [...current, { key: (lineKey += 1), item: "", quantity: "", rate: "" }]);

  const setStock = (index, patch) =>
    setInventory((current) =>
      current.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );

  const remaining = Math.abs(difference);
  const canPost =
    remaining === 0 &&
    debitTotal > 0 &&
    parsed.filter((line) => line.ledger !== "" && line.value > 0).length >= 2;

  async function save() {
    setSaving(true);
    setError(null);
    setWarnings(null);
    try {
      const result = await api("/api/vouchers", {
        method: "POST",
        body: {
          type,
          date,
          narration: narration === "" ? undefined : narration,
          reference: reference === "" ? undefined : reference,
          lines: parsed
            .filter((line) => line.ledger !== "" && line.value > 0)
            .map((line) => ({
              ledger: line.ledger,
              [line.side === "Dr" ? "debit" : "credit"]: line.value,
            })),
          inventory:
            inventory.length === 0
              ? undefined
              : inventory
                  .filter((row) => row.item !== "" && Number(row.quantity) > 0)
                  .map((row) => ({
                    item: row.item,
                    quantity: Number(row.quantity),
                    rate: row.rate === "" ? undefined : Number(String(row.rate).replaceAll(",", "")),
                  })),
        },
      });
      setWarnings(result.warnings ?? []);
      refresh();
      navigate(`voucher/${result.voucher.id}`);
    } catch (failure) {
      setError(failure);
      if (failure.code === "UNBALANCED") setWarnings([]);
    } finally {
      setSaving(false);
    }
  }

  if (!catalog) return <Loading label="Loading voucher types…" />;

  return (
    <Page
      title={`${definition?.name ?? type} voucher`}
      subtitle={`${definition?.shortcut ?? ""} · ${definition?.requires?.hint ?? "Debits and credits must agree before posting"}`}
      actions={
        <>
          <label className="inline-field">
            <span>Date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="inline-field">
            <span>Number</span>
            <input value={nextNumber.data?.number ?? "…"} readOnly className="mono" />
          </label>
        </>
      }
    >
      {error && <ErrorNote error={error} />}
      {warnings && warnings.length > 0 && (
        <Notice tone="warn" title="Posted with warnings">
          <ul>
            {warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        </Notice>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canPost && !saving) save();
        }}
      >
        <div className="grid two">
          <Card title="Voucher" subtitle="Header details">
            <div className="form-grid">
              <Field label="Voucher type">
                <select
                  value={type}
                  onChange={(event) => navigate(`voucher/new?type=${event.target.value}`)}
                >
                  {catalog.voucherTypes.map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.name} ({entry.shortcut})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Party reference" hint="Shown on this screen only; the party is read from the lines">
                <input
                  ref={firstInput}
                  list="ledger-names"
                  value={party}
                  placeholder="Start typing a ledger…"
                  onChange={(event) => setParty(event.target.value)}
                />
              </Field>
              <Field label="Reference">
                <input value={reference} onChange={(event) => setReference(event.target.value)} />
              </Field>
              <Field label="Narration" wide>
                <input
                  value={narration}
                  placeholder="What happened?"
                  onChange={(event) => setNarration(event.target.value)}
                />
              </Field>
            </div>
            <datalist id="ledger-names">
              {ledgerRows.map((ledger) => (
                <option key={ledger.id} value={ledger.name}>
                  {ledger.group}
                </option>
              ))}
            </datalist>
          </Card>

          <Card title="Summary" subtitle="Live totals">
            <dl className="facts">
              <div>
                <dt>Debits</dt>
                <dd className="num">{money(debitTotal)}</dd>
              </div>
              <div>
                <dt>Credits</dt>
                <dd className="num">{money(creditTotal)}</dd>
              </div>
              <div>
                <dt>Difference</dt>
                <dd className={`num ${remaining === 0 ? "good" : "bad"}`}>{money(remaining)}</dd>
              </div>
            </dl>
            <p className="muted small">
              {remaining === 0 && debitTotal > 0
                ? "Balanced. Save to post."
                : `Enter ${rupee(remaining)} more on the ${difference > 0 ? "credit" : "debit"} side.`}
            </p>
            <div className="button-row">
              <Button variant="primary" type="submit" disabled={!canPost || saving}>
                {saving ? "Posting…" : "Post voucher"}
              </Button>
              <Button variant="ghost" onClick={addLine}>
                Add line
              </Button>
            </div>
          </Card>
        </div>

        <Card
          title="Ledger entries"
          subtitle="Every line is one side of the double entry"
          actions={
            <Button variant="ghost" onClick={addLine}>
              + Line
            </Button>
          }
        >
          <div className="table-wrap">
            <table className="entry-table">
              <thead>
                <tr>
                  <th style={{ width: "44%" }}>Ledger</th>
                  <th style={{ width: "12%" }}>Dr / Cr</th>
                  <th className="align-right" style={{ width: "20%" }}>
                    Amount
                  </th>
                  <th>Group</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {parsed.map((line, index) => (
                  <tr key={line.key}>
                    <td>
                      <input
                        list="ledger-names"
                        value={line.ledger}
                        placeholder="Select ledger"
                        onChange={(event) => setLine(index, { ledger: event.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        value={line.side}
                        onChange={(event) => setLine(index, { side: event.target.value })}
                      >
                        <option value="Dr">Dr</option>
                        <option value="Cr">Cr</option>
                      </select>
                    </td>
                    <td className="align-right">
                      <input
                        className="num-input"
                        inputMode="decimal"
                        value={line.amount}
                        placeholder="0.00"
                        onChange={(event) => setLine(index, { amount: event.target.value })}
                      />
                    </td>
                    <td className="muted small">{line.ledgerRow?.group ?? "—"}</td>
                    <td>
                      <Button variant="ghost" onClick={() => removeLine(index)} aria-label="Remove line">
                        ×
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="total-row">
                  <td colSpan={2}>Totals</td>
                  <td className="align-right num">
                    {money(debitTotal)} Dr / {money(creditTotal)} Cr
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        {STOCK_TYPES.has(type) && (
          <Card
            title="Inventory"
            subtitle="Stock moves only on sales, purchase and the two note vouchers"
            actions={
              <Button variant="ghost" onClick={addInventory}>
                + Item
              </Button>
            }
          >
            {inventory.length === 0 ? (
              <p className="muted">No stock lines. Post the voucher as pure accounting if that is correct.</p>
            ) : (
              <Table
                columns={[
                  {
                    key: "item",
                    label: "Stock item",
                    render: (row, index) => (
                      <input
                        list="stock-names"
                        value={row.item}
                        onChange={(event) => setStock(index, { item: event.target.value })}
                      />
                    ),
                  },
                  {
                    key: "quantity",
                    label: "Quantity",
                    align: "right",
                    numeric: true,
                    render: (row, index) => (
                      <input
                        className="num-input"
                        value={row.quantity}
                        onChange={(event) => setStock(index, { quantity: event.target.value })}
                      />
                    ),
                  },
                  {
                    key: "rate",
                    label: "Rate",
                    align: "right",
                    numeric: true,
                    render: (row, index) => (
                      <input
                        className="num-input"
                        value={row.rate}
                        onChange={(event) => setStock(index, { rate: event.target.value })}
                      />
                    ),
                  },
                  {
                    key: "value",
                    label: "Value",
                    align: "right",
                    numeric: true,
                    render: (row) =>
                      money(
                        (Number(row.quantity) || 0) * (Number(String(row.rate).replaceAll(",", "")) || 0),
                      ),
                  },
                ]}
                rows={inventory}
                rowKey={(row) => row.key}
                empty="No stock lines."
              />
            )}
            <datalist id="stock-names">
              {itemNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Card>
        )}
      </form>
    </Page>
  );
}
