import type { ActionType } from "@antelopejs/interface-dms-automation";
import { httpAction } from "./http";
import { logAction } from "./log";

export const builtinActions: ActionType[] = [httpAction, logAction];
