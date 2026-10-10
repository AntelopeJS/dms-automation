import { h } from "vue";
import { defineDmsPlugin } from "#dms/frontend-module";

// The cell display the procedures table names (src/displays/index.ts):
// `automation:last-runs`. A universal plugin, so the server render draws the
// cells. The trigger and failed-step cells are the DMS `two_line` display,
// over texts the server composes (src/runtime/wording.ts).

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

export default defineDmsPlugin(() => {
  const { registerDataType } = useDataTypes();
  registerDataType({
    id: "automation:last-runs",
    formatter: {
      default: (value, _locale, options) => renderLastRuns(value, options),
      empty: (value, _locale, options) => renderLastRuns(value, options),
    },
  });
});
