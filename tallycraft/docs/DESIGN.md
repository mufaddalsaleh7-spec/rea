# Design notes

How TallyCraft stores a book, why the reports cannot disagree with the vouchers,
and where the model stops.

## Sign convention

One rule, applied everywhere:

```
debit  = positive paise
credit = negative paise
```

A ledger balance is `opening + Σ(movements)`. A trial balance balances exactly
when every ledger balance sums to zero. No report reinterprets a sign; `Dr`/`Cr`
is a presentation choice made at the edge (`formatDrCr`, the browser client).

Amounts are integers in paise. Float is used only while parsing operator input
and while formatting output.

## Tables

```
companies     one row per book: financial year, GSTIN, state
groups        28 predefined groups: name, parent, nature, natural direction
ledgers       name (unique), group, signed opening, GSTIN, party type, credit days
vouchers      type, number, date, narration, reference, party, gross total
voucher_lines voucher_id, ledger_id, signed amount, bill reference, position
stock_items   name, group, unit, opening qty (milli-units), opening value, GST rate
voucher_inventory  voucher_id, item, signed qty, rate, amount
```

`UNIQUE(type, number)` and `UNIQUE(ledgers.name)` are the only hard identity
constraints; everything else is derived. Indexes cover `vouchers(date)`,
`vouchers(type, date)`, and both line foreign keys.

Quantities use milli-units so 0.5 m is exact. Dates are ISO `YYYY-MM-DD`
strings: lexicographic order is chronological order, which keeps every range
query and index honest.

## Voucher validation

`createVoucher` is the only write path for the journal:

1. Type is resolved from code, display name, or function key.
2. The date must be inside the company's financial year (`OUTSIDE_FINANCIAL_YEAR`).
3. Every ledger must exist (`UNKNOWN_LEDGER`); `Stock-in-Hand` is reserved
   (`RESERVED_GROUP`).
4. Lines must be at least two, non-zero, and sum to exactly zero paise
   (`TOO_FEW_LINES`, `INVALID_AMOUNT`, `UNBALANCED` — the latter carries the
   difference in the error details).
5. Numbers auto-increment per type and financial year, and duplicates are
   rejected (`DUPLICATE_VOUCHER` with the next free number).
6. Type-specific shape is checked as a **warning**, not a block
   (`UNUSUAL_LEDGER_GROUP`, `ONE_SIDED`). Tally permits unusual vouchers; so does
   this model, but it tells the operator.

The insert runs in a transaction; a failure leaves no partial voucher.

## Reading the book

Both balance readers go through `#movements(from, to)`, one grouped SQL pass that
returns, per ledger, the signed total before `from` and inside the window. Then:

- `balancesAt(date)` → opening + everything up to `date`.
- `balancesIn(from, to)` → opening carried to `from`, movement inside, closing.

Reports roll ledgers up the group tree (`#rollup`), so a group figure is always
the sum of its children — never a separately maintained number.

## Periodic inventory and the balance-sheet identity

Inventory is **not** posted to the general ledger. Instead:

- `Stock-in-Hand` is a reserved group: vouchers cannot touch it, so the book
  value of stock never changes by manual entry.
- The P&L adds _Opening Stock_ as a trading debit and _Closing Stock_ as a
  trading credit, both derived from the inventory register.
- The balance sheet replaces the stock ledger balance with the derived closing
  stock.

Why the sheet still balances, with `A` assets, `L` liabilities, `Inc` income,
`Exp` expense in magnitudes:

```
double entry:            A − L − Inc + Exp = 0      ⇒  A − L = Inc − Exp = profit
P&L after adjustment:    profit′ = profit + closingStock − openingStock
assets after adjustment: A′ = A − stockOnBooks + closingStock
because stockOnBooks = openingStock (no postings allowed),
                         A′ − L = profit′
```

A test asserts `assets == liabilities` on four dates and that the P&L's net
profit equals the balance sheet's Profit & Loss A/c line.

Valuation is weighted average over opening stock plus inward receipts:

```
rate = (openingValue + inwardValue) / (openingQty + inwardQty)
closingValue = closingQty × rate
```

This is a _periodic_ model: it does not revalue on each issue and does not post
cost of goods sold per invoice. That is a documented limitation, not an
oversight.

## Report semantics

| Report           | Scope                    | Special rules                                                                                                |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Trial balance    | Balances at `asOf`       | Group rows roll up children; totals counted from ledgers only so they are not double-counted                 |
| Balance sheet    | Balances at `asOf`       | Profit & Loss A/c computed from the P&L for `FY start … asOf`; inventory replaces the stock ledger           |
| Profit & loss    | `from … to`              | Trading section adds opening and closing stock; gross profit flows into the indirect section                 |
| Day book         | One date                 | Debit and credit legs listed separately; totals must agree                                                   |
| Ledger statement | One ledger, `from … to`  | Opening = ledger opening + movements before `from`; running balance per entry                                |
| Outstanding      | Party balances at `asOf` | Opening balance becomes a synthetic bill dated at the FY start, so ageing buckets sum to the closing balance |
| Stock summary    | Movement up to `asOf`    | Weighted average; quantities never negative in the demo book                                                 |
| GST summary      | Movement in `from … to`  | `Duties & Taxes` ledgers, split into output tax and input credit; utilisation is not posted                  |

## Voucher numbering

`PREFIX-NNNN`, scanned per type per financial year by parsing existing numbers,
not by counting rows — deleting a voucher does not reuse its number, and
importing a book with gaps keeps the next number above the highest seen.

## Tally XML mapping

| TallyCraft            | Tally XML                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Company               | `SVCURRENTCOMPANY`                                                                       |
| Financial year window | `SVFROMDATE`, `SVTODATE` (`YYYYMMDD`)                                                    |
| Group                 | `<GROUP NAME="…"><PARENT>…</PARENT>`                                                     |
| Ledger                | `<LEDGER NAME="…"><PARENT>…</PARENT><OPENINGBALANCE>…</OPENINGBALANCE>`                  |
| Voucher               | `<VOUCHER VCHTYPE="Sales">` with `DATE`, `VOUCHERNUMBER`, `NARRATION`, `PARTYLEDGERNAME` |
| Debit line            | `<ALLLEDGERENTRIES.LIST>` + `ISDEEMEDPOSITIVE=Yes` + negative `AMOUNT`                   |
| Credit line           | `<ALLLEDGERENTRIES.LIST>` + `ISDEEMEDPOSITIVE=No` + positive `AMOUNT`                    |
| Bill reference        | `<BILLALLOCATIONS.LIST><NAME>…</NAME>`                                                   |

Opening balances are signed: debit positive, credit negative. Import trusts the
`ISDEEMEDPOSITIVE` flag first and the magnitude second, so both the usual
Tally export shape (negative debits) and sign-only exports import correctly.
The parser is a small purpose-built reader: no DTD, no external entities, and
mismatched tags are an error rather than a guess.

## Concurrency and durability

SQLite in WAL mode with `BEGIN IMMEDIATE` for writes and savepoints for nesting
(a batch import can call `createVoucher`, which owns its own transaction).
Import runs as one transaction, so a bad envelope changes nothing; `dryRun`
commits nothing by rolling back explicitly.

## Known limitations

- **No native Tally files**: `.900`/`.tsf` are proprietary; only XML interchange.
- **Single company per database**, no multi-currency.
- **No statutory modules**: TDS/TCS, e-invoice, e-way bill, payroll, GST return
  filing, bank reconciliation, cost centres, budgets, audit trail/versioning.
- **No user accounts or permissions**; the server assumes a trusted local host.
- **Periodic inventory** without per-line COGS postings or godown transfers.
- **Bill-wise detail** is captured (`billRef`) but not reconciled against
  settlements; ageing uses the posting date.
- **Interface, not implementation**: no binary evidence of Tally Prime was
  available (see [REA-EVIDENCE.md](REA-EVIDENCE.md)). Layout and wording are
  modelled, not copied.

## Where to take it next

1. Post inventory to the ledger (perpetual method) and reconcile with the
   periodic statements already produced.
2. Add bank reconciliation and a bills-settlement ledger to make ageing exact.
3. Add cost centres and multi-company books, both natural extensions of the
   existing key structure.
4. Replace the demo seed with a company onboarding flow and migration from real
   Tally XML exports.
