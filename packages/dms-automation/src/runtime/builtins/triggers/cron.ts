import type { TriggerType } from "@antelopejs/interface-dms-automation";
import cron, { type ScheduledTask } from "node-cron";

interface CronConfig {
  cron: string;
}

interface CronOutput {
  firedAt: string;
}

export const cronTrigger: TriggerType<CronConfig, CronOutput> = {
  id: "schedule.cron",
  name: "Schedule (cron)",
  description: "Fires on a cron schedule",
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
        default: "* * * * *",
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
    if (!cron.validate(config.cron)) {
      throw new Error(`invalid cron expression: "${config.cron}"`);
    }
    const task = cron.schedule(config.cron, () => {
      emit({ firedAt: new Date().toISOString() });
    });
    return task;
  },
  async deactivate(handle) {
    const task = handle as ScheduledTask | undefined;
    if (!task) return;
    await task.stop();
    if (typeof task.destroy === "function") {
      await task.destroy();
    }
  },
};
