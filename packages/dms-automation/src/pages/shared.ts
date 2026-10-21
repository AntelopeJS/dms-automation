import {
  type BannerButtonAction,
  ButtonVariant,
  type CustomButton,
} from "@antelopejs/interface-dms/base";
import {
  CodeType,
  DefaultDataTypes,
} from "@antelopejs/interface-dms/base/data-types";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { Form } from "@antelopejs/interface-dms/base/form";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { KpiCard } from "@antelopejs/interface-dms/base/kpi-card";
import { LiveToggle } from "@antelopejs/interface-dms/base/live-toggle";
import {
  PAGE_TOOLBAR_LIVE_DEFAULTS,
  PAGE_TOOLBAR_PERIOD_DEFAULTS,
  PageToolbar,
} from "@antelopejs/interface-dms/base/page-toolbar";
import type { PeriodPreset } from "@antelopejs/interface-dms/base/period-selector";
import { PeriodSelector } from "@antelopejs/interface-dms/base/period-selector";
import { RegisterPageTopic } from "@antelopejs/interface-dms/realtime";

/** Base URL of the module's pages. */
const MODULE_URL = "/modules/automation";
export const RUNS_URL = `${MODULE_URL}/runs`;
export const BUILDER_URL = `${MODULE_URL}/builder`;
export const PROCEDURES_URL = `${MODULE_URL}/procedures`;
export const TRACE_URL = `${MODULE_URL}/trace`;

/** Base URL of the module's API. */
export const API_URL = "/api/automation";

/**
 * The windows the overview and the run history offer. `last-24h` slides with
 * the clock, which is what an on-call view wants.
 */
const PERIOD_PRESETS: PeriodPreset[] = [
  "last-24h",
  "last-7-days",
  "last-30-days",
];

/** One of the windows the pages offer. */
export function isPeriodPreset(
  value: string | undefined,
): value is PeriodPreset {
  return (PERIOD_PRESETS as readonly (string | undefined)[]).includes(value);
}

/**
 * The 24 h / 7 d / 30 d window of a page, publishing under `scope`, with the
 * start of the window and the period before it ("vs …") beside the presets.
 * The overview and the run history remember one choice: the period follows
 * the user from one to the other.
 */
function periodSwitch(scope: string) {
  return PeriodSelector({
    ...PAGE_TOOLBAR_PERIOD_DEFAULTS,
    id: scope,
    rememberKey: "automation",
    presets: PERIOD_PRESETS,
    defaultPreset: "last-24h",
    defaultComparison: "previous-period",
    comparisons: ["previous-period"],
  }).meta({
    name: "$dms_automation.permissions.period.name",
    description: "$dms_automation.permissions.period.description",
    icon: "i-ph-calendar-blank",
  });
}

/**
 * Keeps a page declared with `live` in step with `topics`: each event they
 * publish refreshes every block of the page through its Live / Pause. The
 * DMS KPI card takes no realtime topic of its own, and a custom block binds
 * none to its page, so this one binds them. Chart and top list cards do take
 * a `realtimeTopic`, but this refresh already reaches them: giving them one
 * too would read them twice per event.
 */
function liveTopics(topics: string[]) {
  return CustomComponent("dms-automation-live-topics")
    .options({ realtimeTopic: topics })
    .meta({
      name: "$dms_automation.permissions.liveTopics.name",
      description: "$dms_automation.permissions.liveTopics.description",
      icon: "i-ph-broadcast",
    })
    .onCreated((page) => {
      const pageId = page.pageInfo?.fullId;
      if (!pageId) return;
      for (const topic of topics) RegisterPageTopic(pageId, topic);
    });
}

/**
 * The bar first in the body of the overview and the run history: how long
 * ago the page was read with its Live / Pause, the period of `scope`, and
 * what keeps the page live (`topics`), which draws nothing. Built by hand
 * rather than with `pageToolbar()` to keep the `toggle` and `topics` ids
 * roles already grant under the page's `live`.
 */
export function automationToolbar({
  topics,
  scope,
}: {
  topics: string[];
  scope: string;
}) {
  return PageToolbar()
    .child("toggle", LiveToggle(PAGE_TOOLBAR_LIVE_DEFAULTS))
    .child("topics", liveTopics(topics))
    .child("period", periodSwitch(scope))
    .meta({
      name: "$dms_automation.permissions.live.name",
      description: "$dms_automation.permissions.live.description",
      icon: "i-ph-broadcast",
    });
}

/** The run history's period scope, which links from the overview name. */
export const RUNS_PERIOD_SCOPE = "automation-runs";

/** The run KPIs, in the order both pages show them; `invert` when a rise is bad news. */
const KPIS = [
  { id: "runs", metric: "runs", icon: "i-ph-play-circle", invert: false },
  {
    id: "successRate",
    metric: "success-rate",
    icon: "i-ph-check-circle",
    invert: false,
  },
  { id: "failed", metric: "failed", icon: "i-ph-x-circle", invert: true },
  {
    id: "durationP95",
    metric: "duration-p95",
    icon: "i-ph-timer",
    invert: true,
  },
] as const;

/**
 * The four run KPIs of a page over the period of `scope`, read from
 * `<fetchUrl>/<metric>`: the same row, in the same order, on the overview and
 * the run history. Duration p95 is in milliseconds, like the run lists.
 */
export function kpiRow(
  scope: string,
  { fetchUrl, sparkline = false }: { fetchUrl: string; sparkline?: boolean },
) {
  const row = GridRow();
  for (const { id, metric, icon, invert } of KPIS) {
    row.child(
      id,
      KpiCard({
        title:
          metric === "duration-p95"
            ? "$dms_automation.kpi.durationP95"
            : `$dms_automation.kpi.${metric}`,
        variant: "stat",
        icon,
        fetchUrl: `${fetchUrl}/${metric}`,
        periodScope: scope,
        showDelta: true,
        showSparkline: sparkline,
        sparklineAccent: "auto",
        invert,
        compareLabel: "$dms_automation.kpi.vsPrevious",
        valueFormat: metric === "success-rate" ? "percent" : "number",
      }),
    );
  }
  // 260px keeps four cards on one line on a wide screen and two by two at
  // 1024px, where a 3 + 1 split left a card alone and cut the titles.
  return Grid({ gap: "1rem", minColumnWidth: "260px" }).child("row", row);
}

/** What can start a new procedure from the "New procedure" dialog. */
const STARTER_OPTIONS = [
  {
    value: "webhook",
    label: "$dms_automation.newProcedure.starts.webhook",
    description: "$dms_automation.newProcedure.starts.webhookHint",
    icon: "i-ph-webhooks-logo",
  },
  {
    value: "schedule.cron",
    label: "$dms_automation.newProcedure.starts.schedule",
    description: "$dms_automation.newProcedure.starts.scheduleHint",
    icon: "i-ph-clock",
  },
  {
    value: "manual",
    label: "$dms_automation.newProcedure.starts.manual",
    description: "$dms_automation.newProcedure.starts.manualHint",
    icon: "i-ph-play",
  },
];

type Starter = "webhook" | "schedule.cron" | "manual";

/** The "New procedure" dialog: name it, pick what starts it, open the builder. */
function newProcedureForm(trigger: Starter = "webhook") {
  return Form({
    submitUrl: `${API_URL}/procedures/new`,
    submitUrlMethod: "POST",
    submitLabel: "$dms_automation.newProcedure.submit",
    kind: "action",
    redirectOnSuccess: `${BUILDER_URL}?selected={{response._id}}`,
    fields: [
      {
        id: "name",
        label: "$dms_automation.newProcedure.name",
        type: new DefaultDataTypes.StringType({
          placeholder: "$dms_automation.newProcedure.namePlaceholder",
          // The limit the procedure routes enforce.
          maxLength: 200,
        }),
        required: true,
      },
      {
        id: "trigger",
        label: "$dms_automation.newProcedure.startsWhen",
        type: new DefaultDataTypes.SelectType({
          items: STARTER_OPTIONS,
          display: "cards",
        }),
        defaultValue: trigger,
        required: true,
      },
      {
        id: "description",
        label: "$dms_automation.newProcedure.description",
        type: new DefaultDataTypes.StringType({ textarea: true, rows: 2 }),
      },
    ],
  }).meta({
    name: "$dms_automation.permissions.newProcedure.name",
    description: "$dms_automation.permissions.newProcedure.description",
    icon: "i-ph-plus",
  });
}

const RECIPES: { id: string; trigger: Starter; icon: string }[] = [
  { id: "webhook", trigger: "webhook", icon: "i-ph-webhooks-logo" },
  { id: "digest", trigger: "schedule.cron", icon: "i-ph-clock" },
  { id: "manual", trigger: "manual", icon: "i-ph-play" },
];

/**
 * The first-run recipes of the overview banner: each opens "New procedure"
 * with its trigger picked, and the dialog then opens the builder.
 */
export function recipeActions(): BannerButtonAction[] {
  return RECIPES.map((recipe) => ({
    label: `$dms_automation.recipes.${recipe.id}.title`,
    icon: recipe.icon,
    variant: ButtonVariant.outline,
    color: "neutral",
    target: {
      type: "modal",
      size: "md",
      title: `$dms_automation.recipes.${recipe.id}.title`,
      description: `$dms_automation.recipes.${recipe.id}.hint`,
      component: newProcedureForm(recipe.trigger).serializeSync(),
    },
  }));
}

/** Header button opening the "New procedure" dialog. */
export function newProcedureButton(): CustomButton {
  return {
    id: "new-procedure",
    label: "$dms_automation.newProcedure.title",
    icon: "i-ph-plus",
    color: "primary",
    target: {
      type: "modal",
      size: "md",
      title: "$dms_automation.newProcedure.title",
      description: "$dms_automation.newProcedure.subtitleDraft",
      component: newProcedureForm(),
    },
  };
}

/** The "Import JSON" dialog: paste an exported procedure, get a draft. */
function importProcedureForm() {
  return Form({
    submitUrl: `${API_URL}/procedures/import`,
    submitUrlMethod: "POST",
    submitLabel: "$dms_automation.importProcedure.submit",
    kind: "action",
    redirectOnSuccess: `${BUILDER_URL}?selected={{response._id}}`,
    fields: [
      {
        id: "json",
        label: "$dms_automation.importProcedure.json",
        description: "$dms_automation.importProcedure.jsonHint",
        // A code editor: monospace, and JSON that does not parse is refused
        // before it is sent.
        type: new CodeType({ language: "json", minLines: 12, maxLines: 20 }),
        required: true,
      },
    ],
  }).meta({
    name: "$dms_automation.permissions.importProcedure.name",
    description: "$dms_automation.permissions.importProcedure.description",
    icon: "i-ph-upload-simple",
  });
}

/** Header button opening the "Import JSON" dialog. */
export function importProcedureButton(): CustomButton {
  return {
    id: "import-procedure",
    label: "$dms_automation.importProcedure.title",
    icon: "i-ph-upload-simple",
    variant: ButtonVariant.outline,
    color: "neutral",
    target: {
      type: "modal",
      size: "lg",
      title: "$dms_automation.importProcedure.title",
      description: "$dms_automation.importProcedure.subtitle",
      component: importProcedureForm(),
    },
  };
}
