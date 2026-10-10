import type { BlockText } from "@antelopejs/interface-dms/base/types";
import type { StepName, TriggerSummary } from "./describe";

/**
 * The texts the table cells draw for a trigger or a step, composed in the
 * reader's language by the DMS: the server sends i18n keys and raw values,
 * never a finished sentence. The builder and the trace word the same objects
 * client-side (`frontend-vue/app/utils/describe.ts`); both must stay in step.
 */

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const NUMBER = /^\d+$/;
const EVERY_N = /^\*\/(\d+)$/;
const TWO_DIGITS = 2;
const CRON = "dms_automation.cron";

function pad(value: string): string {
  return value.padStart(TWO_DIGITS, "0");
}

/** Five-field (or six with seconds) cron expression split in its fields. */
function cronFields(expression: string): string[] | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length === 6) return parts.slice(1);
  return parts.length === 5 ? parts : null;
}

type CronFields = [string, string, string, string, string];

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
  return everyHours
    ? { key: `${CRON}.everyHours`, params: { n: everyHours } }
    : null;
}

/** The shapes that fire once a day: every day, on weekdays, on one day. */
function dailyText([
  minute,
  hour,
  ,
  ,
  dayOfWeek,
]: CronFields): BlockText | null {
  if (!NUMBER.test(minute) || !NUMBER.test(hour)) return null;
  const time = `${pad(hour)}:${pad(minute)}`;
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
 * "Every day at 02:00", "Mondays at 09:00"), the expression itself
 * otherwise.
 */
export function cronText(expression: string): BlockText {
  const fields = cronFields(expression) as CronFields | null;
  if (!fields) return expression;
  const [, , dayOfMonth, month, dayOfWeek] = fields;
  if (dayOfMonth !== "*" || month !== "*") return expression;
  const text =
    dayOfWeek === "*"
      ? (repeatingText(fields) ?? dailyText(fields))
      : dailyText(fields);
  return text ?? expression;
}

/**
 * What starts a procedure or a run, in a few words: the webhook's method and
 * path, the schedule in words, or the trigger's name.
 */
export function triggerText(
  trigger: TriggerSummary | null | undefined,
): BlockText {
  if (!trigger) return "$dms_automation.trigger.none";
  if (trigger.path) return `${trigger.method ?? "POST"} ${trigger.path}`;
  if (trigger.cron) return cronText(trigger.cron);
  return trigger.typeName;
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
  return typeof text === "string" && text.startsWith("$")
    ? { key: text.slice(1) }
    : text;
}
