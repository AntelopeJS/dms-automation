/**
 * Next occurrence of a cron expression, for the builder's "paused" banner
 * ("next would be Oct 5"). node-cron computes it only for a running task, and
 * a paused procedure has none, so the expression is matched here: five fields
 * (minute, hour, day of month, month, day of week), or six with seconds first,
 * with `*`, lists, ranges, steps and English month and day names.
 */

interface FieldSpec {
  min: number;
  max: number;
  names?: Record<string, number>;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const DAY_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const FIELDS: FieldSpec[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: MONTH_NAMES },
  { min: 0, max: 7, names: DAY_NAMES },
];

const MINUTE_FIELDS = 5;
const SECOND_FIELDS = 6;
const SUNDAY_ALIAS = 7;
/** How far ahead an occurrence is looked for. */
const HORIZON_DAYS = 366;
const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60_000;

function valueOf(token: string, spec: FieldSpec): number {
  const named = spec.names?.[token.toLowerCase().slice(0, 3)];
  const value = named ?? Number(token);
  if (!Number.isInteger(value) || value < spec.min || value > spec.max) {
    throw new Error(`invalid cron value "${token}"`);
  }
  return value;
}

function rangeOf(part: string, spec: FieldSpec): [number, number] {
  if (part === "*") return [spec.min, spec.max];
  const [from, to] = part.split("-");
  const start = valueOf(from ?? "", spec);
  return [start, to === undefined ? start : valueOf(to, spec)];
}

/** The values one field allows. */
function parseField(field: string, spec: FieldSpec): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`invalid cron step "${part}"`);
    }
    const [start, end] = rangeOf(range ?? "", spec);
    // `5/15` means from 5 to the end of the field, every 15.
    const last =
      stepText !== undefined && !range?.includes("-") ? spec.max : end;
    for (let v = start; v <= last; v += step) values.add(v);
  }
  return values;
}

interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  anyDayOfMonth: boolean;
  anyDayOfWeek: boolean;
}

function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== MINUTE_FIELDS && parts.length !== SECOND_FIELDS) {
    throw new Error(`invalid cron expression "${expression}"`);
  }
  const fields = parts.length === SECOND_FIELDS ? parts.slice(1) : parts;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields.map((f, i) =>
    parseField(f, FIELDS[i]!),
  ) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  if (dayOfWeek.has(SUNDAY_ALIAS)) dayOfWeek.add(0);
  return {
    minutes: minute,
    hours: hour,
    daysOfMonth: dayOfMonth,
    months: month,
    daysOfWeek: dayOfWeek,
    anyDayOfMonth: fields[2] === "*",
    anyDayOfWeek: fields[4] === "*",
  };
}

// Like cron: when both day fields are restricted, either one matching is
// enough; when one is `*`, the other decides.
function dayMatches(cron: ParsedCron, date: Date): boolean {
  const dom = cron.daysOfMonth.has(date.getDate());
  const dow = cron.daysOfWeek.has(date.getDay());
  if (cron.anyDayOfMonth && cron.anyDayOfWeek) return true;
  if (cron.anyDayOfMonth) return dow;
  if (cron.anyDayOfWeek) return dom;
  return dom || dow;
}

/**
 * The first minute after `from` the expression matches, in the server's time
 * zone, or `undefined` when it never does within a year or does not parse.
 */
export function nextOccurrence(
  expression: string,
  from: Date = new Date(),
): Date | undefined {
  let cron: ParsedCron;
  try {
    cron = parseCron(expression);
  } catch {
    return undefined;
  }
  const t = new Date(from.getTime());
  t.setSeconds(0, 0);
  t.setTime(t.getTime() + MS_PER_MINUTE);
  const limit = HORIZON_DAYS * MINUTES_PER_DAY;
  for (let i = 0; i < limit; i++) {
    if (!cron.months.has(t.getMonth() + 1) || !dayMatches(cron, t)) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (cron.hours.has(t.getHours()) && cron.minutes.has(t.getMinutes())) {
      return t;
    }
    t.setTime(t.getTime() + MS_PER_MINUTE);
  }
  return undefined;
}
