import type {
  ActionType,
  DataNodeType,
  TriggerType,
} from "@antelopejs/interface-dms-automation";

type TypeKind = "trigger" | "action" | "data";

class Registry {
  private triggers = new Map<string, TriggerType>();
  private actions = new Map<string, ActionType>();
  private dataNodes = new Map<string, DataNodeType>();
  // When each type still missing was unregistered, as a count of removals:
  // a run tells a type its module took away while it ran from one that was
  // never there.
  private removals = 0;
  private removedAt = new Map<string, number>();

  private added(kind: TypeKind, id: string) {
    this.removedAt.delete(`${kind}:${id}`);
  }
  private removed(kind: TypeKind, id: string) {
    this.removals += 1;
    this.removedAt.set(`${kind}:${id}`, this.removals);
  }
  /** A mark to compare `removedSince` with. */
  removalMark(): number {
    return this.removals;
  }
  /** Whether this type was unregistered after `mark`, and is still missing. */
  removedSince(kind: TypeKind, id: string, mark: number): boolean {
    return (this.removedAt.get(`${kind}:${id}`) ?? 0) > mark;
  }

  addTrigger(id: string, t: TriggerType) {
    this.triggers.set(id, t);
    this.added("trigger", id);
  }
  removeTrigger(id: string) {
    if (this.triggers.delete(id)) this.removed("trigger", id);
  }
  getTrigger(id: string) {
    return this.triggers.get(id);
  }
  listTriggers(): TriggerType[] {
    return [...this.triggers.values()];
  }

  addAction(id: string, a: ActionType) {
    this.actions.set(id, a);
    this.added("action", id);
  }
  removeAction(id: string) {
    if (this.actions.delete(id)) this.removed("action", id);
  }
  getAction(id: string) {
    return this.actions.get(id);
  }
  listActions(): ActionType[] {
    return [...this.actions.values()];
  }

  addDataNode(id: string, d: DataNodeType) {
    this.dataNodes.set(id, d);
    this.added("data", id);
  }
  removeDataNode(id: string) {
    if (this.dataNodes.delete(id)) this.removed("data", id);
  }
  getDataNode(id: string) {
    return this.dataNodes.get(id);
  }
  listDataNodes(): DataNodeType[] {
    return [...this.dataNodes.values()];
  }
}

export const registry = new Registry();
