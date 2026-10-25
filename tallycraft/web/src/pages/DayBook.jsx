/** Day book: everything posted on one date, with the day's totals. */

import { useApi } from "../api.js";
import { Link } from "../link.jsx";
import { Card, ErrorNote, Loading, Page, Table } from "../components.jsx";
import { prettyDate, rupee, shiftDate, today } from "../format.js";
import { navigate } from "../router.js";
import { Badge } from "../components.jsx";

export default function DayBook({ route }) {
  const date = route.params.date ?? today();
  const book = useApi(`/api/reports/day-book?date=${date}`, [date]);
  const move = (days) => navigate("day-book", { date: shiftDate(date, days) });

  return (
    <Page
      title="Day book"
      subtitle={book.data ? `${book.data.company} · ${book.data.count} voucher(s)` : "Loading…"}
      actions={
        <>
          <button className="button ghost" onClick={() => move(-1)} aria-label="Previous day">
            ←
          </button>
          <input type="date" value={date} onChange={(event) => navigate("day-book", { date: event.target.value })} />
          <button className="button ghost" onClick={() => move(1)} aria-label="Next day">
            →
          </button>
          <button className="button ghost" onClick={() => navigate("day-book", { date: today() })}>
            Today
          </button>
        </>
      }
    >
      {book.error && <ErrorNote error={book.error} onRetry={book.reload} />}
      {book.loading && <Loading />}
      {book.data && (
        <Card
          title={prettyDate(book.data.date)}
          subtitle="Vouchers in entry order"
          actions={
            book.data.totals && (
              <Badge tone="neutral">
                Dr {rupee(book.data.totals.debit)} · Cr {rupee(book.data.totals.credit)}
              </Badge>
            )
          }
        >
          <Table
            columns={[
              { key: "number", label: "Number" },
              { key: "typeName", label: "Type" },
              {
                key: "particulars",
                label: "Particulars",
                render: (row) => row.party?.name ?? row.narration ?? "—",
              },
              { key: "narration", label: "Narration" },
              { key: "total", label: "Amount", align: "right", numeric: true, render: (row) => rupee(row.total) },
              { key: "open", label: "", align: "right", render: (row) => <Link to={`voucher/${row.id}`}>Open</Link> },
            ]}
            rows={book.data.vouchers}
            rowKey={(row) => row.id}
            footer={
              <tr className="total-row">
                <td colSpan={4}>Total</td>
                <td className="align-right num">{rupee(book.data.totals?.debit ?? 0)}</td>
                <td />
              </tr>
            }
            empty="Nothing posted on this date. Press F8 for a sales voucher."
          />
        </Card>
      )}
    </Page>
  );
}
