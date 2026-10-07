import {
  ButtonVariant,
  type CustomButton,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import { Form } from "@antelopejs/interface-dms/base/form";
import type { PeriodPreset } from "@antelopejs/interface-dms/base/period-selector";
import { PeriodSelector } from "@antelopejs/interface-dms/base/period-selector";

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

/** The 24 h / 7 d / 30 d switch of a page, publishing under `scope`. */
export function periodSwitch(scope: string) {
  return PeriodSelector({
    id: scope,
    variant: "segmented",
    presets: PERIOD_PRESETS,
    defaultPreset: "last-24h",
    defaultComparison: "previous-period",
    comparisons: ["previous-period"],
    align: "right",
    size: "sm",
    showRangeLabel: false,
  }).meta({
    name: "$dms_automation.permissions.period.name",
    description: "$dms_automation.permissions.period.description",
    icon: "i-ph-calendar-blank",
  });
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

/** The "New procedure" dialog: name it, pick what starts it, open the builder. */
function newProcedureForm() {
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
          maxLength: 120,
        }),
        required: true,
      },
      {
        id: "trigger",
        label: "$dms_automation.newProcedure.startsWhen",
        description: "$dms_automation.newProcedure.startsWhenHint",
        type: new DefaultDataTypes.SelectType({
          items: STARTER_OPTIONS,
          display: "cards",
        }),
        defaultValue: "webhook",
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
      description: "$dms_automation.newProcedure.subtitle",
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
        type: new DefaultDataTypes.StringType({ textarea: true, rows: 12 }),
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
