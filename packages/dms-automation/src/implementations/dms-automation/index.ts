import type {
  ActionType,
  DataNodeType,
  TriggerType,
} from "@antelopejs/interface-dms-automation";
import { registry } from "../../runtime/registry";
import { subscriptions } from "../../runtime/subscriptions";

export namespace internal {
  export const RegisterTriggerType = {
    register: (id: string, type: TriggerType): void => {
      registry.addTrigger(id, type);
    },
    unregister: (id: string): void => {
      // Best-effort deactivate any live handles using this type before removal.
      void subscriptions.deactivateAllForTriggerType(id);
      registry.removeTrigger(id);
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
