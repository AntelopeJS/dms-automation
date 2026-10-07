/**
 * Wording of automation objects the backend sends structured: a trigger, a
 * schedule, a step, a duration. Every function takes the translator, so cells,
 * cards and the builder say the same thing in the reader's language.
 */

/** `processI18n` of the DMS translation composable. */
export type Translate = (
  key: string,
  params?: Record<string, unknown>,
) => string;

/** What starts a procedure or a run (see the backend `TriggerSummary`). */
export interface TriggerSummary {
  nodeId?: string;
  typeId: string;
  typeName: string;
  method?: string;
  path?: string;
  cron?: string;
}

/** A step, named by its label or the name of its type. */
export interface StepName {
  nodeId: string;
  label?: string;
  typeName?: string;
  kind?: string;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const NUMBER = /^\d+$/;
const EVERY_N = /^\*\/(\d+)$/;
const TWO_DIGITS = 2;

function pad(value: string): string {
  return value.padStart(TWO_DIGITS, "0");
}

function timeOf(hour: string, minute: string): string {
  return `${pad(hour)}:${pad(minute)}`;
}

/** Five-field (or six with seconds) cron expression split in its fields. */
function cronFields(expression: string): string[] | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length === 6) return parts.slice(1);
  return parts.length === 5 ? parts : null;
}

function weekdayName(field: string, t: Translate): string | null {
  if (!NUMBER.test(field)) return null;
  const day = WEEKDAYS[Number(field) % WEEKDAYS.length];
  return day ? t(`$dms_automation.cron.days.${day}`) : null;
}

/**
 * A cron expression in words for the common shapes ("Every 15 minutes",
 * "Every day at 02:00", "Mondays at 09:00"), the expression itself
 * otherwise.
 */
export function describeCron(expression: string, t: Translate): string {
  const fields = cronFields(expression);
  if (!fields) return expression;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  const anyDate = dayOfMonth === "*" && month === "*";
  if (minute === "*" && hour === "*" && anyDate && dayOfWeek === "*") {
    return t("$dms_automation.cron.everyMinute");
  }
  const everyMinutes = EVERY_N.exec(minute);
  if (everyMinutes && hour === "*" && anyDate && dayOfWeek === "*") {
    return t("$dms_automation.cron.everyMinutes", { n: everyMinutes[1] });
  }
  if (!NUMBER.test(minute)) return expression;
  if (hour === "*" && anyDate && dayOfWeek === "*") {
    return t("$dms_automation.cron.hourly", { minute: pad(minute) });
  }
  const everyHours = EVERY_N.exec(hour);
  if (everyHours && anyDate && dayOfWeek === "*") {
    return t("$dms_automation.cron.everyHours", { n: everyHours[1] });
  }
  if (!NUMBER.test(hour) || !anyDate) return expression;
  const time = timeOf(hour, minute);
  if (dayOfWeek === "*") return t("$dms_automation.cron.daily", { time });
  if (dayOfWeek === "1-5") return t("$dms_automation.cron.weekdays", { time });
  const day = weekdayName(dayOfWeek, t);
  return day ? t("$dms_automation.cron.weekly", { day, time }) : expression;
}

/** What starts a procedure, in a few words. */
export function describeTrigger(
  trigger: TriggerSummary | null | undefined,
  t: Translate,
): string {
  if (!trigger) return t("$dms_automation.trigger.none");
  if (trigger.path) return `${trigger.method ?? "POST"} ${trigger.path}`;
  if (trigger.cron) return describeCron(trigger.cron, t);
  return t(trigger.typeName);
}

/** Icon of a trigger type, for the places that only have its summary. */
export function triggerIcon(
  trigger: TriggerSummary | null | undefined,
): string {
  if (!trigger) return "i-ph-circle-dashed";
  if (trigger.path) return "i-ph-webhooks-logo";
  if (trigger.cron) return "i-ph-clock";
  if (trigger.typeId === "manual") return "i-ph-play";
  return "i-ph-lightning";
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

/** "14:28" today, "Mon 14:28" this week, "Sep 22, 14:28" before. */
export function describeTime(
  date: string | Date | null | undefined,
  locale?: string,
): string {
  if (!date) return "—";
  const d = new Date(date);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat(pageLocale(locale), options).format(d);
}

/** Pretty JSON for a payload or an output, `null` shown as such. */
export function prettyJson(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

/** Parse a stored payload string, keeping the text when it is not JSON. */
export function parsePayload(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** What a node does, in one line, from its settings (AU-10). */
export function summarizeNode(
  kind: string,
  typeId: string | undefined,
  config: Record<string, unknown> | undefined,
  t: Translate,
): string {
  const c = config ?? {};
  const text = (key: string) =>
    typeof c[key] === "string" ? (c[key] as string) : "";
  if (kind === "trigger") {
    if (text("path")) return `${text("method") || "POST"} ${text("path")}`;
    if (text("cron")) return describeCron(text("cron"), t);
    return "";
  }
  if (text("url")) return `${text("method") || "GET"} ${shortUrl(text("url"))}`;
  if (kind === "delay" && c.ms !== undefined)
    return describeDuration(Number(c.ms));
  if (text("message")) return `“${text("message")}”`;
  if (kind === "data" && c.value !== undefined && typeof c.value !== "object")
    return String(c.value);
  if (Array.isArray(c.cases))
    return (c.cases as unknown[]).map(String).join(" · ");
  if (typeof c.maxAttempts === "number")
    return t("$dms_automation.nodes.attempts", { n: c.maxAttempts });
  if (Array.isArray(c.ports))
    return (c.ports as unknown[]).map(String).join(" · ");
  if (kind === "setVariable" && text("name")) return `${text("name")} =`;
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
