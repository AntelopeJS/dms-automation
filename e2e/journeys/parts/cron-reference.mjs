const NAMES = new Map([
  ["jan", 1],
  ["feb", 2],
  ["mar", 3],
  ["apr", 4],
  ["may", 5],
  ["jun", 6],
  ["jul", 7],
  ["aug", 8],
  ["sep", 9],
  ["oct", 10],
  ["nov", 11],
  ["dec", 12],
  ["sun", 0],
  ["mon", 1],
  ["tue", 2],
  ["wed", 3],
  ["thu", 4],
  ["fri", 5],
  ["sat", 6],
]);

/**
 * The values a cron field allows, from its own reading of lists, ranges, steps and names.
 *
 * @param {string} field One field
 * @param {number} min The smallest value
 * @param {number} max The largest value
 * @returns {Set<number>} The values
 */
function valuesOf(field, min, max) {
  /** @type {Set<number>} */
  const values = new Set();
  /** @param {string} token A number or a month or weekday name */
  const named = (token) => NAMES.get(token.toLowerCase().slice(0, 3)) ?? Number(token);
  for (const part of field.split(",")) {
    const [range = "", step] = part.split("/");
    const every = step === undefined ? 1 : Number(step);
    const bounds = range === "*" ? [min, max] : range.split("-").map(named);
    const from = bounds[0] ?? min;
    const to = bounds[1];
    const last = range === "*" || to !== undefined ? (to ?? max) : step === undefined ? from : max;
    for (let value = from; value <= last; value += every) values.add(value);
  }
  return values;
}

/**
 * The first second after `from` a cron expression fires, in UTC, by looking at every minute in turn: an
 * independent reading of the docs' schedule semantics (either day field matching is enough when both are set).
 *
 * @param {string} expression Five fields, or six with seconds first
 * @param {Date} from The instant to look after
 * @returns {Date | null} The next occurrence within a year, null when none
 */
export function nextFire(expression, from) {
  const parts = expression.trim().split(/\s+/);
  const withSeconds = parts.length === 6;
  const [seconds, minute, hour, dayOfMonth, month, dayOfWeek] = withSeconds ? parts : ["0", ...parts];
  const allowed = {
    second: valuesOf(seconds, 0, 59),
    minute: valuesOf(minute, 0, 59),
    hour: valuesOf(hour, 0, 23),
    dom: valuesOf(dayOfMonth, 1, 31),
    month: valuesOf(month, 1, 12),
    dow: valuesOf(dayOfWeek, 0, 7),
  };
  if (allowed.dow.has(7)) allowed.dow.add(0);
  const start = new Date(from.getTime());
  start.setUTCMilliseconds(0);
  const cursor = new Date(start.getTime() + 1000);
  for (let guard = 0; guard < 366 * 24 * 60 + 2; guard += 1) {
    const dayOk = dayOfMonth === "*" && dayOfWeek === "*" ? true : dayOfMonth === "*" ? allowed.dow.has(cursor.getUTCDay()) : dayOfWeek === "*" ? allowed.dom.has(cursor.getUTCDate()) : allowed.dom.has(cursor.getUTCDate()) || allowed.dow.has(cursor.getUTCDay());
    if (allowed.month.has(cursor.getUTCMonth() + 1) && dayOk && allowed.hour.has(cursor.getUTCHours()) && allowed.minute.has(cursor.getUTCMinutes())) {
      const second = [...allowed.second].sort((a, b) => a - b).find((candidate) => candidate >= cursor.getUTCSeconds());
      if (second !== undefined) {
        cursor.setUTCSeconds(second);
        return cursor;
      }
    }
    cursor.setUTCSeconds(0);
    cursor.setTime(cursor.getTime() + 60_000);
  }
  return null;
}
