import type { TriggerType } from "@antelopejs/interface-dms-automation";
import { cronTrigger } from "./cron";
import { manualTrigger } from "./manual";
import { webhookTrigger } from "./webhook";

export const builtinTriggers: TriggerType[] = [
  manualTrigger,
  cronTrigger,
  webhookTrigger,
];
