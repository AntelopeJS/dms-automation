import type { ProcedureSummaryRow } from "../db/models/stats.model";
import { stateRank } from "../stats/health";
import { isNumber, isObjectOrNull, isString } from "../types/guards";

/**
 * A query-string value as text: the API hands a parameter sent without a
 * value (`?search`, an emptied search field) in as `true`.
 */
function queryText(raw: QueryValue): string {
  return isString(raw) ? raw.trim() : "";
}

/** Text as the search compares it: lower case, accents dropped. */
function folded(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

interface ColumnFilter {
  mode: string;
  values: string[];
}

function parseFilter(raw: QueryValue): ColumnFilter | undefined {
  const text = queryText(raw);
  if (!text) return undefined;
  const idx = text.indexOf(":");
  const [mode, value] =
    idx < 0 ? ["is", text] : [text.slice(0, idx), text.slice(idx + 1)];
  const values = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length ? { mode, values } : undefined;
}

const NEGATED_MODES = new Set(["is_not", "exclude"]);

/** Whether a row holding these values passes a column filter. */
function passes(
  values: readonly string[],
  filter: ColumnFilter | undefined,
): boolean {
  if (!filter) return true;
  const hit = values.some((v) => filter.values.includes(v));
  return NEGATED_MODES.has(filter.mode) ? !hit : hit;
}

/**
 * What the search reads in a row: its name and description, the paths and
 * schedules of its triggers, and its last error.
 */
function searchedText(row: ProcedureSummaryRow): string {
  return folded(
    [
      row.name,
      row.description,
      row.lastError ?? "",
      ...row.triggers.flatMap((t) => [t.path ?? "", t.cron ?? ""]),
    ].join("\n"),
  );
}

/** The table's query: its search and its column filters, raw. */
export interface ProceduresQuery {
  search?: QueryValue;
  filter_status?: QueryValue;
  filter_triggerTypes?: QueryValue;
}

/** The rows the search and the status and trigger filters keep. */
export function applyQuery(
  rows: ProcedureSummaryRow[],
  query: ProceduresQuery,
): ProcedureSummaryRow[] {
  const q = folded(queryText(query.search));
  const status = parseFilter(query.filter_status);
  const triggerTypes = parseFilter(query.filter_triggerTypes);
  return rows.filter(
    (r) =>
      (!q || searchedText(r).includes(q)) &&
      passes([r.status], status) &&
      passes(r.triggerTypes, triggerTypes),
  );
}

const SORTABLE_KEYS = [
  "name",
  "trigger",
  "status",
  "lastRunAt",
  "successRate",
  "avgDurationMs",
  "runs",
] as const satisfies readonly (keyof ProcedureSummaryRow)[];

function isSortableKey(key: string): key is (typeof SORTABLE_KEYS)[number] {
  return SORTABLE_KEYS.some((sortable) => sortable === key);
}

/**
 * A query-string value as the API hands it in: text, or `true` for a
 * parameter sent without a value.
 */
export type QueryValue = string | true | undefined;

type SortValue = ProcedureSummaryRow[keyof ProcedureSummaryRow];

/** Text a row's value sorts by: its JSON for an object (a trigger summary). */
function sortText(value: SortValue): string {
  return isObjectOrNull(value) ? JSON.stringify(value) : String(value);
}

function compareValues(a: SortValue, b: SortValue, dir: number): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (isNumber(a) && isNumber(b)) return (a - b) * dir;
  return sortText(a).localeCompare(sortText(b)) * dir;
}

/**
 * By state, the ones that need attention first (last with `dir` -1), then by
 * name.
 */
function byState(
  a: ProcedureSummaryRow,
  b: ProcedureSummaryRow,
  dir = 1,
): number {
  return (
    (stateRank(a.status) - stateRank(b.status)) * dir ||
    a.name.localeCompare(b.name)
  );
}

export function sortRows(
  rows: ProcedureSummaryRow[],
  sortKey?: QueryValue,
  sortDirection?: QueryValue,
): ProcedureSummaryRow[] {
  const k = queryText(sortKey);
  if (!isSortableKey(k)) return [...rows].sort((a, b) => byState(a, b));
  const dir = sortDirection === "desc" ? -1 : 1;
  if (k === "status") return [...rows].sort((a, b) => byState(a, b, dir));
  return [...rows].sort((a, b) => compareValues(a[k], b[k], dir));
}

/**
 * Parse a query-string integer, falling back when it is missing or not a finite
 * number (so a malformed `?limit=abc` doesn't slice to an empty page).
 */
export function toInt(raw: QueryValue, fallback: number, min: number): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** A procedure as the runs table's relation picker lists it. */
export interface ProcedureOption {
  procedureId: string;
  _id: string;
  name: string;
}

/**
 * The picker's options, sorted by name: those of the `ids` asked for when
 * there are (`?ids=`: how a picked procedure's chip and field name it), else
 * those the search matches.
 */
export function procedureOptions(
  procedures: Array<{ _id: string; name: string }>,
  search: QueryValue,
  ids: string[] = [],
): ProcedureOption[] {
  const q = folded(queryText(search));
  const asked = new Set(ids);
  return procedures
    .map((p) => ({ procedureId: p._id, _id: p._id, name: p.name }))
    .filter((p) => asked.size === 0 || asked.has(p.procedureId))
    .filter((p) => !q || folded(p.name).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}
