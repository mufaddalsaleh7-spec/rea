/**
 * Ledger masters.
 *
 * List, search, filter by group, then create or amend in place. Deleting is
 * refused by the backend once a voucher uses the ledger, and the message says
 * exactly that, so the UI does not need to pre-check.
 */

import { useMemo, useState } from "react";
import { api, useApi } from "../api.js";
import { Link } from "../link.jsx";
import { Badge, Button, Card, ErrorNote, Field, Loading, Notice, Page, Table } from "../components.jsx";
import { money } from "../format.js";
import { useApp } from "../App.jsx";

const BLANK = {
  name: "",
  group: "",
  opening: "",
  openingType: "Dr",
  gstin: "",
  phone: "",
  address: "",
  creditDays: "",
};

export default function Ledgers() {
  const { catalog, refresh, tick } = useApp();
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const query = new URLSearchParams();
  if (group) query.set("group", group);
  if (search.trim()) query.set("search", search.trim());
  const ledgers = useApi(`/api/ledgers${query.toString() ? `?${query}` : ""}`, [group, search, tick]);

  const rows = ledgers.data?.ledgers ?? [];
  const groups = useMemo(
    () => [...new Set((catalog?.groups ?? []).map((entry) => entry.name))].sort(),
    [catalog],
  );

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...draft };
      if (!body.group) delete body.group;
      if (body.creditDays === "") delete body.creditDays;
      if (draft.id) {
        await api(`/api/ledgers/${draft.id}`, { method: "PATCH", body });
      } else {
        await api("/api/ledgers", { method: "POST", body });
      }
      setDraft(null);
      refresh();
      ledgers.reload();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  async function remove(ledger) {
    if (!globalThis.confirm(`Delete ledger "${ledger.name}"?`)) return;
    setError(null);
    try {
      await api(`/api/ledgers/${ledger.id}`, { method: "DELETE" });
      refresh();
      ledgers.reload();
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <Page
      title="Ledgers"
      subtitle={`${rows.length} ledgers${group ? ` in ${group}` : ""}`}
      actions={
        <Button variant="primary" onClick={() => setDraft({ ...BLANK, group: group || "" })}>
          New ledger
        </Button>
      }
    >
      {error && <ErrorNote error={error} />}

      <div className="filters">
        <input
          placeholder="Search by name…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select value={group} onChange={(event) => setGroup(event.target.value)}>
          <option value="">All groups</option>
          {groups.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {draft && (
        <Card
          title={draft.id ? `Amend ${draft.name}` : "New ledger"}
          subtitle="Opening balances are entered in Tally's Dr/Cr language"
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <Field label="Name">
                <input
                  autoFocus
                  required
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field label="Group">
                <select
                  required
                  value={draft.group}
                  onChange={(event) => setDraft({ ...draft, group: event.target.value })}
                >
                  <option value="">Choose a group…</option>
                  {groups.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Opening balance">
                <input
                  value={draft.opening}
                  placeholder="0.00"
                  onChange={(event) => setDraft({ ...draft, opening: event.target.value })}
                />
              </Field>
              <Field label="Opening side">
                <select
                  value={draft.openingType}
                  onChange={(event) => setDraft({ ...draft, openingType: event.target.value })}
                >
                  <option value="Dr">Dr</option>
                  <option value="Cr">Cr</option>
                </select>
              </Field>
              <Field label="GSTIN">
                <input
                  value={draft.gstin ?? ""}
                  onChange={(event) => setDraft({ ...draft, gstin: event.target.value })}
                />
              </Field>
              <Field label="Phone">
                <input
                  value={draft.phone ?? ""}
                  onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                />
              </Field>
              <Field label="Address" wide>
                <input
                  value={draft.address ?? ""}
                  onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                />
              </Field>
              <Field label="Credit days">
                <input
                  inputMode="numeric"
                  value={draft.creditDays ?? ""}
                  onChange={(event) => setDraft({ ...draft, creditDays: event.target.value })}
                />
              </Field>
            </div>
            <div className="button-row">
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : draft.id ? "Save changes" : "Create ledger"}
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {ledgers.loading && <Loading />}
      <Card title="Chart of ledgers" subtitle="Click a ledger to open its statement">
        <Table
          columns={[
            {
              key: "name",
              label: "Ledger",
              render: (row) => <Link to={`ledger/${row.id}`}>{row.name}</Link>,
            },
            { key: "group", label: "Group" },
            {
              key: "nature",
              label: "Nature",
              render: (row) => <Badge tone={row.nature === "assets" ? "ok" : "neutral"}>{row.nature}</Badge>,
            },
            {
              key: "opening",
              label: "Opening",
              align: "right",
              numeric: true,
              render: (row) => `${money(Math.abs(row.opening))} ${row.opening === 0 ? "" : row.opening > 0 ? "Dr" : "Cr"}`,
            },
            { key: "gstin", label: "GSTIN", render: (row) => row.gstin ?? "—" },
            {
              key: "actions",
              label: "",
              align: "right",
              render: (row) => (
                <span className="row-actions">
                  <button className="linkish" onClick={() => setDraft({ ...BLANK, ...row, opening: Math.abs(row.opening), openingType: row.opening < 0 ? "Cr" : "Dr" })}>
                    Amend
                  </button>
                  <button className="linkish danger" onClick={() => remove(row)}>
                    Delete
                  </button>
                </span>
              ),
            },
          ]}
          rows={rows}
          rowKey={(row) => row.id}
          empty="No ledger matches that filter."
        />
      </Card>

      {rows.length === 0 && !ledgers.loading && (
        <Notice tone="info">Nothing matched. Clear the search or create the ledger.</Notice>
      )}
    </Page>
  );
}
