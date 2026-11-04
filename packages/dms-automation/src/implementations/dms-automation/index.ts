import type {
  ActionType,
  DataNodeType,
  DeclaredProcedure,
  JsonValue,
  ProcedureDeclaration,
  ProcedureRunOutcome,
  RunProcedureOptions,
  TriggerType,
} from "@antelopejs/interface-dms-automation";
import { runNow, runResult } from "../../routes/procedureRuns";
import { declareProcedure } from "../../runtime/declaredProcedures";
import { whenStarted } from "../../runtime/readiness";
import { loadProcedure, parseStoredGraph } from "../../runtime/runProcedure";
import { registry } from "../../runtime/registry";
import { subscriptions } from "../../runtime/subscriptions";

export namespace internal {
  export const RegisterTriggerType = {
    register: (id: string, type: TriggerType): void => {
      registry.addTrigger(id, type);
      subscriptions.onTriggerTypeRegistered(id);
    },
    unregister: (id: string): void => {
      registry.removeTrigger(id);
      void subscriptions.onTriggerTypeUnregistered(id);
    },
  };

  export const RegisterActionType = {
    register: (id: string, type: ActionType): void => {
      registry.addAction(id, type);
    },
    unregister: (id: string): void => {
      registry.removeAction(id);
    },
  };

  export const RegisterDataNodeType = {
    register: (id: string, type: DataNodeType): void => {
      registry.addDataNode(id, type);
    },
    unregister: (id: string): void => {
      registry.removeDataNode(id);
    },
  };
}

export async function ListTriggerTypes(): Promise<TriggerType[]> {
  return registry.listTriggers();
}

export async function ListActionTypes(): Promise<ActionType[]> {
  return registry.listActions();
}

export async function ListDataNodeTypes(): Promise<DataNodeType[]> {
  return registry.listDataNodes();
}

export async function InvokeProcedure(
  id: string,
  payload?: JsonValue,
): Promise<string> {
  return subscriptions.invokeManual(id, payload);
}

export async function RunProcedure(
  id: string,
  options: RunProcedureOptions = {},
): Promise<ProcedureRunOutcome> {
  await whenStarted();
  const graph = parseStoredGraph(await loadProcedure(id));
  return await runResult(await runNow(id, graph, options));
}

export async function DeclareProcedure(
  declaration: ProcedureDeclaration,
): Promise<DeclaredProcedure> {
  await whenStarted();
  return declareProcedure(declaration);
}
