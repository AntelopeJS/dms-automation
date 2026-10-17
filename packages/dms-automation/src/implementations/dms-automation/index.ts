import type {
  ActionType,
  DataNodeType,
  DeclaredProcedure,
  ProcedureDeclaration,
  TriggerType,
} from "@antelopejs/interface-dms-automation";
import { declareProcedure } from "../../runtime/declaredProcedures";
import { whenStarted } from "../../runtime/readiness";
import { registry } from "../../runtime/registry";
import { subscriptions } from "../../runtime/subscriptions";

export namespace internal {
  export const RegisterTriggerType = {
    register: (id: string, type: TriggerType): void => {
      registry.addTrigger(id, type);
      subscriptions.onTriggerTypeRegistered(id);
    },
    unregister: (id: string): void => {
      // Each live handle retains its own definition for queued teardown.
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
  payload?: unknown,
): Promise<string> {
  return subscriptions.invokeManual(id, payload);
}

export async function DeclareProcedure(
  declaration: ProcedureDeclaration,
): Promise<DeclaredProcedure> {
  await whenStarted();
  return declareProcedure(declaration);
}
