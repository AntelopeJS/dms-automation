import { Logging } from "@antelopejs/interface-core/logging";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import type { DataValue } from "../../../types/dataValue";

type LogLevelName = "info" | "warn" | "error";

interface LogInput {
  message?: string;
  value?: DataValue;
  level?: LogLevelName;
}

type LogOutput = {
  message: string;
  value: DataValue;
};

const channel = new Logging.Channel("dms-automation");

/** Route each log level to its channel method, replacing an if/else-if chain. */
const channelByLevel: Record<LogLevelName, (...args: unknown[]) => void> = {
  info: (...args) => channel.Info(...args),
  warn: (...args) => channel.Warn(...args),
  error: (...args) => channel.Error(...args),
};

/** Writes to the run's log and the server log only: a test runs it as is. */
export const logAction: ActionType<LogInput, LogOutput> = {
  id: "log.message",
  name: "$dms_automation.types.log.name",
  description: "$dms_automation.types.log.description",
  icon: "i-ph-terminal",
  sideEffects: false,
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", default: "" },
      value: {},
      level: {
        type: "string",
        enum: ["info", "warn", "error"],
        default: "info",
      },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
      value: {},
    },
  },
  async execute(input, ctx) {
    const message = input.message ?? "";
    const value = input.value;
    const level = input.level ?? "info";

    ctx.log(level, message, value);

    const tag = `[run=${ctx.runId} node=${ctx.nodeId}]`;
    const args =
      value === undefined
        ? [`${tag} ${message}`]
        : [`${tag} ${message}`, value];
    const writeLog = channelByLevel[level] ?? channelByLevel.info;
    writeLog(...args);
    return { message, value };
  },
};
