import type {
  ActionType,
  DataNodeType,
  TriggerType,
} from "@antelopejs/interface-dms-automation";

export class Registry {
  private triggers = new Map<string, TriggerType>();
  private actions = new Map<string, ActionType>();
  private dataNodes = new Map<string, DataNodeType>();

  addTrigger(id: string, t: TriggerType) {
    this.triggers.set(id, t);
  }
  removeTrigger(id: string) {
    this.triggers.delete(id);
  }
  getTrigger(id: string) {
    return this.triggers.get(id);
  }
  listTriggers(): TriggerType[] {
    return [...this.triggers.values()];
  }

  addAction(id: string, a: ActionType) {
    this.actions.set(id, a);
  }
  removeAction(id: string) {
    this.actions.delete(id);
  }
  getAction(id: string) {
    return this.actions.get(id);
  }
  listActions(): ActionType[] {
    return [...this.actions.values()];
  }

  addDataNode(id: string, d: DataNodeType) {
    this.dataNodes.set(id, d);
  }
  removeDataNode(id: string) {
    this.dataNodes.delete(id);
  }
  getDataNode(id: string) {
    return this.dataNodes.get(id);
  }
  listDataNodes(): DataNodeType[] {
    return [...this.dataNodes.values()];
  }
}

export const registry = new Registry();
