import { h } from "vue";
import { defineDmsPlugin } from "#dms/frontend-module";
import {
  describeTrigger,
  stepTitle,
  triggerIcon,
  type StepName,
  type TriggerSummary,
} from "../utils/describe";

// The cell displays the procedures and runs tables name
// (src/displays/index.ts): `automation:last-runs`, `automation:trigger` and
// `automation:step`. A universal plugin, so the server render draws the cells.

const STATUS_BAR_CLASS: Record<string, string> = {
  ok: "bg-success",
  failed: "bg-error",
};
const DEFAULT_RUN_STRIP = 12;

function renderLastRuns(value: unknown, options: unknown) {
  const limit =
    (options as { limit?: number } | undefined)?.limit ?? DEFAULT_RUN_STRIP;
  const statuses = Array.isArray(value) ? value.map(String).slice(-limit) : [];
  const empty = Array.from({ length: limit - statuses.length }, () => "");
  return h(
    "span",
    {
      class: "inline-flex h-4 items-end gap-[2px]",
      "aria-label": statuses.join(", "),
    },
    [...empty, ...statuses].map((status) =>
      h("span", {
        class: [
          "w-[5px] rounded-[1px]",
          status ? "h-4" : "h-1.5 bg-elevated",
          STATUS_BAR_CLASS[status] ?? "",
        ],
      }),
    ),
  );
}

function renderTrigger(value: unknown) {
  const { processI18n } = useTranslation();
  const trigger = value as TriggerSummary | null;
  return h("span", { class: "inline-flex min-w-0 items-center gap-1.5" }, [
    h("span", {
      class: [triggerIcon(trigger), "size-3.5 shrink-0 text-muted"],
    }),
    h(
      "span",
      {
        class: [
          "truncate text-xs",
          trigger?.path ? "font-mono" : "",
          trigger ? "text-toned" : "text-dimmed",
        ],
      },
      describeTrigger(trigger, processI18n),
    ),
  ]);
}

function renderStep(value: unknown) {
  const { processI18n } = useTranslation();
  const step = value as StepName | null;
  if (!step?.nodeId) return h("span", { class: "text-dimmed" }, "—");
  return h(
    "span",
    { class: "truncate text-xs text-toned" },
    stepTitle(step, processI18n),
  );
}

export default defineDmsPlugin(() => {
  const { registerDataType } = useDataTypes();
  registerDataType({
    id: "automation:last-runs",
    formatter: {
      default: (value, _locale, options) => renderLastRuns(value, options),
      empty: (value, _locale, options) => renderLastRuns(value, options),
    },
  });
  registerDataType({
    id: "automation:trigger",
    formatter: {
      default: (value) => renderTrigger(value),
      empty: () => renderTrigger(null),
    },
  });
  registerDataType({
    id: "automation:step",
    formatter: {
      default: (value) => renderStep(value),
      empty: () => renderStep(null),
    },
  });
});
