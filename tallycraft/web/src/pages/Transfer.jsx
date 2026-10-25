/**
 * Tally XML interchange.
 *
 * Export streams the envelope straight from the book; import accepts the same
 * envelope, and the dry run is a real dry run — the backend posts inside a
 * transaction it rolls back, so duplicates and unbalanced vouchers surface
 * before anything is written.
 */

import { useState } from "react";
import { ApiError, api } from "../api.js";
import { Badge, Button, Card, ErrorNote, Field, Notice, Page } from "../components.jsx";
import { useApp } from "../App.jsx";

export default function Transfer() {
  const { company, refresh } = useApp();
  const [from, setFrom] = useState(company?.financialYearStart ?? "");
  const [to, setTo] = useState(company?.financialYearEnd ?? "");
  const [masters, setMasters] = useState(true);
  const [vouchers, setVouchers] = useState(true);
  const [xml, setXml] = useState("");
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function runImport(dryRun) {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const query = new URLSearchParams({ dryRun: String(dryRun) });
      const result = await api(`/api/import/xml?${query}`, { method: "POST", body: xml });
      setSummary(result);
      if (!dryRun) refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure : new ApiError(0, "NETWORK", String(failure)));
    } finally {
      setBusy(false);
    }
  }

  async function exportXml() {
    setBusy(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        from,
        to,
        masters: String(masters),
        vouchers: String(vouchers),
      });
      const body = await api(`/api/export/xml?${query}`, { text: true });
      setXml(body);
      const blob = new Blob([body], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `tallycraft-${new Date().toISOString().slice(0, 10)}.xml`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Import / export"
      subtitle="Tally Prime envelopes in and out, without a connector"
    >
      {error && <ErrorNote error={error} />}

      <div className="grid two">
        <Card title="Export" subtitle="Write an import envelope Tally can read">
          <div className="form-grid">
            <Field label="From">
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="To">
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
          </div>
          <div className="checks">
            <label className="inline-check">
              <input type="checkbox" checked={masters} onChange={(event) => setMasters(event.target.checked)} />
              Masters (groups, ledgers)
            </label>
            <label className="inline-check">
              <input type="checkbox" checked={vouchers} onChange={(event) => setVouchers(event.target.checked)} />
              Vouchers
            </label>
          </div>
          <div className="button-row">
            <Button variant="primary" onClick={exportXml} disabled={busy}>
              Download XML
            </Button>
            <Button variant="ghost" onClick={() => setXml("")} disabled={xml === ""}>
              Clear
            </Button>
          </div>
          {xml && <p className="muted small">{xml.length.toLocaleString()} characters generated.</p>}
        </Card>

        <Card title="Import" subtitle="Paste an envelope, then preview before writing">
          <textarea
            className="code"
            rows={10}
            value={xml}
            placeholder='<?xml version="1.0"?><ENVELOPE>…</ENVELOPE>'
            onChange={(event) => setXml(event.target.value)}
          />
          <div className="button-row">
            <Button onClick={() => runImport(true)} disabled={busy || xml.trim() === ""}>
              Preview (dry run)
            </Button>
            <Button variant="primary" onClick={() => runImport(false)} disabled={busy || xml.trim() === ""}>
              Import for real
            </Button>
          </div>
          {summary && (
            <Notice tone={summary.warnings.length > 0 ? "warn" : "ok"} title={summary.dryRun ? "Dry run — nothing written" : "Imported"}>
              <p>
                <Badge tone="neutral">Ledgers {summary.ledgers}</Badge>{" "}
                <Badge tone="neutral">Vouchers {summary.vouchers}</Badge>{" "}
                <Badge tone="neutral">Skipped {summary.skipped}</Badge>
              </p>
              {summary.warnings.length > 0 && (
                <ul>
                  {summary.warnings.slice(0, 12).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </Notice>
          )}
        </Card>
      </div>

      <Card title="What travels" subtitle="The same shape Tally Prime writes">
        <ul className="plain">
          <li>Groups and ledgers with parents, opening balances and GSTIN.</li>
          <li>Vouchers with their date, number, narration, party and every ledger entry.</li>
          <li>Bill references, so outstanding ageing survives the round trip.</li>
          <li>Amounts in rupees with two decimals; the book itself stays in integer paise.</li>
        </ul>
        <p className="muted small">
          Import never overwrites an existing ledger: it skips it and reports why. Voucher numbers
          are unique per type, so a second import of the same envelope is refused rather than
          duplicated.
        </p>
      </Card>
    </Page>
  );
}
