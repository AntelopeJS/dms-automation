import type { TriggerType } from "@antelopejs/interface-dms-automation";
import cron, { type ScheduledTask } from "node-cron";
import { TriggerArmError } from "../../armErrors";
import type { ConfigProblem } from "../../validate";
import type { DataValue } from "../../../types/dataValue";
import { isString } from "../../../types/guards";

/** The schedule a new schedule trigger starts with: Mondays at 09:00. */
export const DEFAULT_SCHEDULE = "0 9 * * 1";

interface CronConfig {
  cron: string;
}

type CronOutput = {
  firedAt: string;
};

/** Why a cron expression can never fire, or undefined when it is valid. */
export function cronProblem(expression: DataValue): ConfigProblem | undefined {
  if (isString(expression) && cron.validate(expression)) {
    return undefined;
  }
  const value = isString(expression) ? expression : "";
  return {
    code: "cronInvalid",
    params: { cron: value },
    message: `invalid cron expression: "${value}"`,
  };
}

export const cronTrigger: TriggerType<CronConfig, CronOutput> = {
  id: "schedule.cron",
  name: "$dms_automation.types.cron.name",
  description: "$dms_automation.types.cron.description",
  icon: "i-ph-clock",
  cluster: "singleton",
  configSchema: {
    type: "object",
    properties: {
      cron: {
        type: "string",
        title: "Schedule (cron expression)",
        description:
          "Standard cron syntax, e.g. `*/5 * * * *` (every 5 minutes) or `0 9 * * 1` (Mondays at 09:00).",
        default: DEFAULT_SCHEDULE,
      },
    },
    required: ["cron"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      firedAt: { type: "string", format: "date-time" },
    },
  },
  async activate(config, emit) {
    const problem = cronProblem(config.cron);
    if (problem) throw new TriggerArmError(problem);
    const task = cron.schedule(config.cron, () => {
      emit({ firedAt: new Date().toISOString() });
    });
    return task;
  },
  async deactivate(task: ScheduledTask | undefined) {
    if (!task) return;
    await task.stop();
    await task.destroy?.();
  },
};
