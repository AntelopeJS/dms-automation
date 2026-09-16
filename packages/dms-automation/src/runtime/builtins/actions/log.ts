import { Logging } from "@antelopejs/interface-core/logging";
import type { ActionType } from "@antelopejs/interface-dms-automation";

type LogLevelName = "info" | "warn" | "error";

interface LogInput {
  message?: string;
  value?: unknown;
  level?: LogLevelName;
}

interface LogOutput {
  message: string;
  value: unknown;
}

const channel = new Logging.Channel("dms-automation");

// Route each log level to its channel method, replacing an if/else-if chain.
const channelByLevel: Record<LogLevelName, (...args: unknown[]) => void> = {
  info: (...args) => channel.Info(...args),
  warn: (...args) => channel.Warn(...args),
  error: (...args) => channel.Error(...args),
};

export const logAction: ActionType<LogInput, LogOutput> = {
  id: "log.message",
  name: "Log",
  description:
    "Emit a message (and optional value) to the dms-automation log channel, tagged with run + node id",
  icon: "i-ph-terminal",
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
    // Fall back to Info for any level outside the known set, matching the
    // previous if/else-if default.
    const writeLog = channelByLevel[level] ?? channelByLevel.info;
    writeLog(...args);
    return { message, value };
  },
};
