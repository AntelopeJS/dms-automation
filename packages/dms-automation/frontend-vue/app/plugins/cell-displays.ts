import { h, isVNode, type VNodeChild } from "vue";
import { defineDmsPlugin, DmsLink } from "#dms/frontend-module";
import { isAbsentOr, isNumber, isRecord, isString } from "../utils/json";

type DataTypeDefinition = Parameters<
  ReturnType<typeof useDataTypes>["registerDataType"]
>[0];
type CellFormatter = NonNullable<DataTypeDefinition["formatter"]>["default"];
type CellRow = Parameters<CellFormatter>[3];

/**
 * A run of the strip, as the procedures summary lists it. A type alias, not an
 * interface, so it fills the run URL's `{{row.runId}}` as a plain record.
 */
type RecentRun = {
  runId: string;
  status: string;
  startedAt: string;
  errorMessage: string | null;
};

interface LastRunsOptions {
  limit?: number;
  runsField?: string;
  runUrl?: string;
  emptyLabel?: string;
}

const STATUS_BAR_CLASS = new Map([
  ["ok", "bg-success"],
  ["failed", "bg-error"],
]);
const DEFAULT_RUN_STRIP = 12;
const BAR_CLASS = "h-4 w-[5px] rounded-[1px]";

function isRecentRun(value: unknown): value is RecentRun {
  return (
    isRecord(value) &&
    isString(value.runId) &&
    isString(value.status) &&
    isString(value.startedAt) &&
    (value.errorMessage === null || isString(value.errorMessage))
  );
}

function isLastRunsOptions(value: unknown): value is LastRunsOptions {
  return (
    isRecord(value) &&
    isAbsentOr(value.limit, isNumber) &&
    isAbsentOr(value.runsField, isString) &&
    isAbsentOr(value.runUrl, isString) &&
    isAbsentOr(value.emptyLabel, isString)
  );
}

function isUrlOptions(value: unknown): value is { url?: string } {
  return isRecord(value) && isAbsentOr(value.url, isString);
}

function isVNodeChild(value: unknown): value is VNodeChild {
  if (
    value === null ||
    value === undefined ||
    isString(value) ||
    isNumber(value) ||
    typeof value === "boolean"
  )
    return true;
  if (isVNode(value)) return true;
  return Array.isArray(value) && value.every(isVNodeChild);
}

/** The runs a row lists under `field`, the ones that read as runs. */
function recentRunsOf(row: CellRow, field: string): RecentRun[] {
  const listed = row && Object.hasOwn(row, field) ? row[field] : undefined;
  return Array.isArray(listed) ? listed.filter(isRecentRun) : [];
}

/** "Failed · 12 Oct 2026, 13:59 · HTTP 404 Not Found". */
function runTitle(run: RecentRun): string {
  const i18n = useI18n();
  const { formatDateTime } = useRegionalFormat();
  const statusKey = `dms_automation.runs.status.${run.status}`;
  return [
    i18n.te(statusKey) ? i18n.t(statusKey) : run.status,
    formatDateTime(run.startedAt),
    run.errorMessage,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * One bar of the strip: a link to its run, named by its tooltip. Out of the
 * tab order (twelve stops a row): the keyboard reaches the last run through
 * the row's "Open last run".
 */
function renderRunBar(run: RecentRun, runUrl: string | undefined) {
  const title = runTitle(run);
  const bar = [BAR_CLASS, STATUS_BAR_CLASS.get(run.status) ?? "bg-accented"];
  return runUrl
    ? h(DmsLink, {
        to: interpolateUrl(runUrl, run),
        class: [bar, "hover:opacity-70"],
        title,
        "aria-label": title,
        tabindex: -1,
      })
    : h("span", { class: bar, title });
}

/**
 * The strip of the row's last runs, over the column's date written like the
 * DMS `relative_date` cell ("2 hr. ago", the exact moment in its tooltip).
 */
const renderLastRuns: CellFormatter = (value, locale, options, row) => {
  const { t } = useI18n();
  const settings: LastRunsOptions = isLastRunsOptions(options) ? options : {};
  const {
    limit = DEFAULT_RUN_STRIP,
    runsField = "lastRuns",
    runUrl,
    emptyLabel,
  } = settings;
  const runs = recentRunsOf(row, runsField).slice(-limit);
  const count = (status: string) =>
    runs.filter((run) => run.status === status).length;
  const label = runs.length
    ? t("dms_automation.procedures.lastRunsLabel", {
        ok: count("ok"),
        failed: count("failed"),
      })
    : t("dms_automation.procedures.detail.noRunYet");
  const empty = Array.from({ length: limit - runs.length }, () =>
    h("span", { class: "h-1.5 w-[5px] rounded-[1px] bg-elevated" }),
  );
  const strip = h(
    "span",
    {
      class: "inline-flex h-4 items-end gap-[2px]",
      role: "group",
      "aria-label": label,
    },
    [...empty, ...runs.map((run) => renderRunBar(run, runUrl))],
  );
  const relativeDate = useDataTypes().getDataType("relative_date")?.formatter;
  const dateOptions = { emptyLabel, emptyTone: "dimmed" };
  const formatted = value
    ? relativeDate?.default(value, locale, dateOptions, row)
    : relativeDate?.empty?.(value, locale, dateOptions, row);
  const date = isVNodeChild(formatted) ? formatted : null;
  return h("span", { class: "flex min-w-0 flex-col items-start gap-1" }, [
    strip,
    date,
  ]);
};

/**
 * The DMS identity cell (icon, name, description) inside a link to the
 * row's page: a click, a middle-click or Enter opens it.
 */
const renderProcedureLink: CellFormatter = (value, locale, options, row) => {
  const identity = useDataTypes().getDataType("identity")?.formatter;
  const cell = identity?.default(value, locale, options, row) ?? String(value);
  const url = isUrlOptions(options) ? options.url : undefined;
  if (!url || !row) return cell;
  return h(
    DmsLink,
    {
      to: interpolateUrl(url, row),
      class:
        "block min-w-0 rounded-sm focus-visible:outline-2 focus-visible:outline-primary [&:hover_.text-highlighted>.truncate]:underline",
    },
    () => cell,
  );
};

/**
 * The cell displays the procedures table names (src/displays/index.ts):
 * `automation:last-runs`, the strip of last runs over the last run's date, and
 * `automation:procedure-link`, a procedure's identity cell as a link. A
 * universal plugin, so the server render draws the cells. The trigger and
 * failed-step cells are the DMS `two_line` display, over texts the server
 * composes (src/runtime/wording.ts).
 */
export default defineDmsPlugin(() => {
  const { registerDataType } = useDataTypes();
  registerDataType({
    id: "automation:last-runs",
    formatter: {
      default: renderLastRuns,
      empty: renderLastRuns,
    },
  });
  registerDataType({
    id: "automation:procedure-link",
    formatter: {
      default: renderProcedureLink,
    },
  });
});
