import { asc, desc, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { AppError, ERROR_CODES } from './errors';

/**
 * Keyset ("cursor") pagination for the admin lists.
 *
 * `OFFSET n` makes the database walk and discard the n rows in front of the one
 * being asked for, so the hundredth batch of an infinite scroll costs a hundred
 * times the first — and the panel now scrolls rather than paging, so that is the
 * common case rather than the rare one. A keyset asks for *the rows after this
 * one* instead, which an index can seek to directly: every batch costs the same.
 *
 * It also fixes something offset paging never could. A list ordered only by
 * `created_at` has no defined order between two rows sharing a timestamp, so the
 * same row could arrive in two consecutive batches while another was never sent
 * at all. Every keyset here therefore ends in the primary key, which makes the
 * order total — that is a correctness requirement of this scheme, not a detail:
 * the cursor is a position in the order, and an order with ties has no positions.
 *
 * The cursor is opaque to the client and holds no secrets — it is the sort values
 * of the last row it was given, which that client had already been sent.
 */

export type CursorValue = string | number | boolean | null;

export interface KeysetColumn<Row> {
  /**
   * The expression `ORDER BY` uses.
   *
   * **It must never be NULL for any row in the list.** `a < NULL` is NULL rather
   * than true or false, so a nullable column silently drops rows from every
   * batch after the first — coalesce it at the call site (and in the `ORDER BY`,
   * which this helper builds from the same expression, so the two cannot drift).
   */
  expr: SQLWrapper;
  order: 'asc' | 'desc';
  /** That expression's value on a returned row. Together these are the cursor. */
  of: (row: Row) => CursorValue | Date | undefined;
}

export interface Keyset<Row> {
  /** Spread into `.orderBy(...)`. Ends in the tiebreaker the caller listed last. */
  orderBy: SQL[];
  /** The `WHERE` fragment for "after this cursor", or undefined for the first batch. */
  after(cursor: string | undefined): SQL | undefined;
  cursorFor(row: Row): string;
  /**
   * Splits a batch read with `limit(pageSize + 1)` into the rows to send and the
   * cursor that follows them. Asking for one row more than fits is what tells
   * "there is another batch" from "that was the last one" without a second query.
   *
   * Generic over the row actually selected, not over `Row`: a handler selects
   * more columns than the cursor reads, and narrowing to `Row` here would strip
   * the rest from the response's type while leaving them in the payload.
   */
  batch<R extends Row>(rows: R[], pageSize: number): { rows: R[]; hasMore: boolean; nextCursor: string | null };
}

function normalise(value: CursorValue | Date | undefined): CursorValue {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function encode(values: CursorValue[]): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

function decode(cursor: string, arity: number): CursorValue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  if (!Array.isArray(parsed) || parsed.length !== arity) throw invalidCursor();

  return parsed.map((value) => {
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    throw invalidCursor();
  });
}

/**
 * A cursor that does not decode is a client bug or a tampered URL, and both are
 * better as a loud 400 than as a silent restart from the top — which would send
 * the first batch again and make the scroll repeat itself forever.
 */
function invalidCursor(): AppError {
  return new AppError(ERROR_CODES.INVALID_CURSOR, 'That page marker is not valid. Reload the list.', 400);
}

export function keyset<Row>(columns: KeysetColumn<Row>[]): Keyset<Row> {
  if (columns.length === 0) throw new Error('A keyset needs at least one column.');

  /**
   * Lexicographic "after", unrolled rather than written as PostgreSQL's row
   * constructor `(a, b) < (x, y)` — that form requires every column to run in
   * the same direction, and these lists mix them (stock ascending, name
   * ascending, but a user-chosen column descending above both).
   */
  function after(values: CursorValue[], index: number): SQL {
    const column = columns[index]!;
    const value = values[index];
    const strict =
      column.order === 'asc' ? sql`${column.expr} > ${value}` : sql`${column.expr} < ${value}`;

    if (index === columns.length - 1) return strict;

    return sql`(${strict} or (${column.expr} = ${value} and ${after(values, index + 1)}))`;
  }

  const self: Keyset<Row> = {
    orderBy: columns.map((column) => (column.order === 'asc' ? asc(column.expr) : desc(column.expr))),

    after(cursor) {
      if (!cursor) return undefined;
      return after(decode(cursor, columns.length), 0);
    },

    cursorFor(row) {
      return encode(columns.map((column) => normalise(column.of(row))));
    },

    batch<R extends Row>(rows: R[], pageSize: number) {
      const hasMore = rows.length > pageSize;
      const page = hasMore ? rows.slice(0, pageSize) : rows;
      const last = page[page.length - 1];

      return {
        rows: page,
        hasMore,
        nextCursor: hasMore && last !== undefined ? self.cursorFor(last) : null,
      };
    },
  };

  return self;
}
