import type { BlockText } from "@antelopejs/interface-dms/base/types";
import type { StepName, TriggerSummary } from "./describe";
import { scheduleTimeZone } from "./schedule";
import { isString } from "../types/guards";

/**
 * The texts the pages draw for a trigger or a step, composed in the reader's
 * language by the DMS: the server sends i18n keys and raw values, never a
 * finished sentence. The only wording of triggers and schedules: the table
 * cells use it, and the routes the builder, the trace and the library read
 * send it next to the trigger they describe.
 */

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const NUMBER = /^\d+$/;
const EVERY_N = /^\*\/(\d+)$/;
const TWO_DIGITS = 2;
const CRON = "dms_automation.cron";

function pad(value: string): string {
  return value.padStart(TWO_DIGITS, "0");
}

type CronFields = [string, string, string, string, string];

/**
 * A cron expression split in its five fields (minute to day of week), with
 * its seconds field: "0" when it has none.
 */
function cronFields(
  expression: string,
): { seconds: string; fields: CronFields } | null {
  const parts = expression.trim().split(/\s+/);
  if (hasSecondsField(parts)) {
    const [seconds, ...fields] = parts;
    return { seconds, fields };
  }
  return hasFiveFields(parts) ? { seconds: "0", fields: parts } : null;
}

function hasFiveFields(parts: string[]): parts is CronFields {
  return parts.length === 5;
}

function hasSecondsField(parts: string[]): parts is [string, ...CronFields] {
  return parts.length === 6;
}

/** The shapes that fire several times a minute: every second, every N seconds. */
function secondsText(seconds: string, fields: CronFields): BlockText | null {
  if (fields.some((field) => field !== "*")) return null;
  if (seconds === "*") return { key: `${CRON}.everySecond` };
  const n = EVERY_N.exec(seconds)?.[1];
  return n ? { key: `${CRON}.everySeconds`, params: { n } } : null;
}

/** The shapes that repeat within the hour or every few hours, any day. */
function repeatingText([minute, hour]: CronFields): BlockText | null {
  if (minute === "*" && hour === "*") return { key: `${CRON}.everyMinute` };
  const everyMinutes = EVERY_N.exec(minute)?.[1];
  if (everyMinutes && hour === "*") {
    return { key: `${CRON}.everyMinutes`, params: { n: everyMinutes } };
  }
  if (!NUMBER.test(minute)) return null;
  if (hour === "*") {
    return { key: `${CRON}.hourly`, params: { minute: pad(minute) } };
  }
  const everyHours = EVERY_N.exec(hour)?.[1];
  if (!everyHours) return null;
  return Number(minute) === 0
    ? { key: `${CRON}.everyHours`, params: { n: everyHours } }
    : {
        key: `${CRON}.everyHoursAt`,
        params: { n: everyHours, minute: pad(minute) },
      };
}

/**
 * The shapes that fire once a day: every day, on weekdays, on one day. The
 * time is the scheduler's, so its time zone is named after it.
 */
function dailyText(
  [minute, hour, , , dayOfWeek]: CronFields,
  timeZone: string,
): BlockText | null {
  if (!NUMBER.test(minute) || !NUMBER.test(hour)) return null;
  const time = `${pad(hour)}:${pad(minute)} (${timeZone})`;
  if (dayOfWeek === "*") return { key: `${CRON}.daily`, params: { time } };
  if (dayOfWeek === "1-5") return { key: `${CRON}.weekdays`, params: { time } };
  const day = NUMBER.test(dayOfWeek)
    ? WEEKDAYS[Number(dayOfWeek) % WEEKDAYS.length]
    : undefined;
  if (!day) return null;
  return {
    key: `${CRON}.weekly`,
    params: { day: { key: `${CRON}.days.${day}` }, time },
  };
}

/**
 * A cron expression in words for the common shapes ("Every 15 minutes",
 * "Every day at 02:00 (Europe/Brussels)", "Mondays at 09:00 (UTC)"), the
 * expression itself otherwise. Clock times are in `timeZone`, the zone the
 * schedules fire in.
 */
export function cronText(
  expression: string,
  timeZone: string = scheduleTimeZone(),
): BlockText {
  const parsed = cronFields(expression);
  if (!parsed) return expression;
  const { seconds, fields } = parsed;
  if (!NUMBER.test(seconds) || Number(seconds) !== 0) {
    return secondsText(seconds, fields) ?? expression;
  }
  const [, , dayOfMonth, month, dayOfWeek] = fields;
  if (dayOfMonth !== "*" || month !== "*") return expression;
  const text =
    dayOfWeek === "*"
      ? (repeatingText(fields) ?? dailyText(fields, timeZone))
      : dailyText(fields, timeZone);
  return text ?? expression;
}

/**
 * What starts a procedure or a run, in a few words: the webhook's method and
 * path, the schedule in words (in the zone the summary names, else the
 * server's), or the trigger's name.
 */
export function triggerText(
  trigger: TriggerSummary | null | undefined,
): BlockText {
  if (!trigger) return "$dms_automation.trigger.none";
  if (trigger.path) return `${trigger.method ?? "POST"} ${trigger.path}`;
  if (trigger.cron) return cronText(trigger.cron, trigger.timeZone);
  return trigger.typeName;
}

/** A trigger with the text it reads as, for a page that lists it. */
export function withTriggerText<T extends TriggerSummary>(
  trigger: T,
): T & { text: BlockText } {
  return { ...trigger, text: triggerText(trigger) };
}

/**
 * The trigger's type under its settings ("Webhook" under "POST /hooks/x"), or
 * nothing when the first line already names the type.
 */
export function triggerTypeText(
  trigger: TriggerSummary | null | undefined,
): BlockText | null {
  if (!trigger || (!trigger.path && !trigger.cron)) return null;
  return trigger.typeName;
}

/** A step's name: its label, else its type's name, else its id. */
export function stepText(step: StepName | null | undefined): BlockText | null {
  if (!step?.nodeId) return null;
  return step.label ?? step.typeName ?? step.nodeId;
}

/**
 * A text as a composed-text parameter: a `$`-prefixed i18n key becomes a
 * nested `ComposedText`, since a string parameter is inserted as written.
 */
export function asParam(text: BlockText): BlockText {
  return isString(text) && text.startsWith("$") ? { key: text.slice(1) } : text;
}
