import {
  isJsonContainer,
  isJsonValue,
  isNumber,
  isScalar,
  isString,
  type JsonObject,
  type JsonValue,
} from "./json";

/**
 * Wording of automation objects the backend sends structured: a step, a
 * duration, a date. Every function takes the translator, so cells, cards and
 * the builder say the same thing in the reader's language. Triggers and
 * schedules are worded by the server, which sends their text next to them
 * (`src/runtime/wording.ts`), written with `useComposedText().processText`.
 */

/** `processI18n` of the DMS translation composable. */
export type Translate = (
  key: string,
  params?: Record<string, JsonValue>,
) => string;

/** What starts a procedure or a run (see the backend `TriggerSummary`). */
export interface TriggerSummary {
  nodeId?: string;
  typeId: string;
  typeName: string;
  method?: string;
  path?: string;
  cron?: string;
  /** The time zone the schedule fires in, the server's. */
  timeZone?: string;
}

/** A trigger with the text the server words it as. */
export interface WordedTrigger extends TriggerSummary {
  text: BlockText;
}

/** A step, named by its label or the name of its type. */
export interface StepName {
  nodeId: string;
  label?: string;
  typeName?: string;
  kind?: string;
}

/** A step's name: its label, else its type's name, else its id. */
export function stepTitle(
  step: StepName | null | undefined,
  t: Translate,
): string {
  if (!step) return "";
  if (step.label) return step.label;
  if (step.typeName) return t(step.typeName);
  return step.nodeId;
}

/** A data port of a node: the schema property it wires by, and its title. */
export interface PortName {
  name: string;
  /** The property's `title`, plain text or a `$`-prefixed DMS i18n key. */
  title?: string;
}

/**
 * The words a port reads as on the canvas: its field's title when one is
 * declared, else its key. Edges and handles keep wiring by the key.
 */
export function portLabel(port: PortName, t: Translate): string {
  const title = port.title?.trim();
  return title ? t(title) : port.name;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/**
 * The reader's language, as the page declares it, for the formatters called
 * without one: dates and durations then follow the DMS language, not the
 * browser's.
 */
function pageLocale(locale?: string): string | undefined {
  if (locale) return locale;
  return typeof document === "undefined"
    ? undefined
    : document.documentElement.lang || undefined;
}

/** A duration in its most readable unit: "640 ms", "2.4 s", "3 min 4 s". */
export function describeDuration(
  ms: number | null | undefined,
  locale?: string,
): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < MS_PER_SECOND) return `${Math.round(ms)} ms`;
  const seconds = ms / MS_PER_SECOND;
  if (seconds < SECONDS_PER_MINUTE) {
    const value = new Intl.NumberFormat(pageLocale(locale), {
      maximumFractionDigits: 1,
    }).format(seconds);
    return `${value} s`;
  }
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes} min ${Math.round(seconds % SECONDS_PER_MINUTE)} s`;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
];

/** "4 min ago", "in 2 days": the distance from now, in the reader's locale. */
export function describeRelative(
  date: string | Date | null | undefined,
  locale?: string,
): string {
  if (!date) return "—";
  const ms = new Date(date).getTime() - Date.now();
  const format = new Intl.RelativeTimeFormat(pageLocale(locale), {
    numeric: "auto",
    style: "short",
  });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(ms) >= size || unit === "second") {
      return format.format(Math.round(ms / size), unit);
    }
  }
  return "";
}

/**
 * Builds the `Intl.DateTimeFormat` a date is written with: the page's
 * `useRegionalFormat().dateTimeFormat`, which adds the user's Language &
 * region settings (time zone, clock, date format) to what is asked for. An
 * explicit `timeZone` wins.
 */
export type DateTimeFormatOf = (
  options: Intl.DateTimeFormatOptions,
) => Intl.DateTimeFormat;

/**
 * How the reader writes hours: "09:05" on a 24-hour clock, "9:05 AM" on a
 * 12-hour one (never "09:05 AM").
 */
function hourStyle(formatOf: DateTimeFormatOf): "2-digit" | "numeric" {
  const { hourCycle } = formatOf({ hour: "numeric" }).resolvedOptions();
  return hourCycle === "h23" || hourCycle === "h24" ? "2-digit" : "numeric";
}

/**
 * A date and time, written the same way on every page: "Oct 12, 1:57 PM",
 * "12 oct., 13:57", with the year when it is not this one. Never all digits,
 * which reads month-first or day-first depending on the reader. In the
 * reader's time zone, or in `timeZone` when the text names it (a schedule's
 * next run, in the server's zone like the schedule itself).
 */
export function describeDateTime(
  date: string | Date | null | undefined,
  formatOf: DateTimeFormatOf,
  timeZone?: string,
): string {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  const yearOf = (value: Date) =>
    formatOf({ year: "numeric", timeZone }).format(value);
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: hourStyle(formatOf),
    minute: "2-digit",
    timeZone,
  };
  if (yearOf(d) !== yearOf(new Date())) options.year = "numeric";
  return formatOf(options).format(d);
}

/** "14:28" today, else the date and time: "Sep 22, 14:28". */
export function describeTime(
  date: string | Date | null | undefined,
  formatOf: DateTimeFormatOf,
): string {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  const dayOf = (value: Date) =>
    formatOf({ year: "numeric", month: "numeric", day: "numeric" }).format(
      value,
    );
  if (dayOf(d) !== dayOf(new Date())) return describeDateTime(d, formatOf);
  return formatOf({ hour: hourStyle(formatOf), minute: "2-digit" }).format(d);
}

/** Pretty JSON for a payload or an output, `null` shown as such. */
export function prettyJson(value: unknown): string {
  return isJsonValue(value) ? JSON.stringify(value, null, 2) : "";
}

/**
 * A run's inputs or output as the backend describes them (`{ type, value }`
 * per value), reduced to the values.
 */
export function unwrapDescribed(
  described: JsonValue | undefined,
): JsonValue | undefined {
  if (!isJsonContainer(described)) return described;
  if ("value" in described && "type" in described) return described.value;
  return Object.fromEntries(
    Object.entries(described).map(([key, value]) => [
      key,
      unwrapDescribed(value),
    ]),
  );
}

function textOf(config: JsonObject, key: string): string {
  const value = config[key];
  return isString(value) ? value : "";
}

function listText(list: JsonValue | undefined): string | null {
  return Array.isArray(list) ? list.map(String).join(" · ") : null;
}

function summarizeTrigger(config: JsonObject, scheduleText?: string): string {
  if (textOf(config, "path"))
    return `${textOf(config, "method") || "POST"} ${textOf(config, "path")}`;
  return textOf(config, "cron") ? (scheduleText ?? textOf(config, "cron")) : "";
}

/**
 * What a node does, in one line, from its settings (AU-10). A schedule reads
 * as `scheduleText`, its words as the server writes them, else as its cron
 * expression.
 */
export function summarizeNode(
  kind: string,
  typeId: string | undefined,
  config: JsonObject | undefined,
  t: Translate,
  scheduleText?: string,
): string {
  const c = config ?? {};
  if (kind === "trigger") return summarizeTrigger(c, scheduleText);
  const url = textOf(c, "url");
  if (url) return `${textOf(c, "method") || "GET"} ${shortUrl(url)}`;
  if (kind === "delay" && c.ms !== undefined)
    return describeDuration(Number(c.ms));
  const message = textOf(c, "message");
  if (message) return `“${message}”`;
  if (kind === "data" && isScalar(c.value)) return String(c.value);
  const cases = listText(c.cases);
  if (cases !== null) return cases;
  if (isNumber(c.maxAttempts))
    return t("$dms_automation.nodes.attempts", { n: c.maxAttempts });
  const ports = listText(c.ports);
  if (ports !== null) return ports;
  const name = textOf(c, "name");
  if (kind === "setVariable" && name) return `${name} =`;
  return typeId && kind === "data" ? typeId : "";
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

/** The colour role of a node's category: trigger, flow, data, action. */
export type NodeRole =
  | "trigger"
  | "flow"
  | "data"
  | "action"
  | "helper"
  | "group";

export function roleOf(kind: string, category?: string): NodeRole {
  if (kind === "trigger") return "trigger";
  if (kind === "action") return "action";
  if (kind === "data") return "data";
  if (kind === "group") return "group";
  return category === "helper" ? "helper" : "flow";
}
