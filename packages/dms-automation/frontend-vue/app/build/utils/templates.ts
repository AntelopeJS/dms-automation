export interface JsonSchema {
  type?: string | string[];
  [key: string]: unknown;
}

export interface TemplatePort {
  name: string;
  kind: "data" | "trigger";
  direction: "in" | "out";
  schema?: JsonSchema;
}

export interface TemplateRow {
  _id: string;
  name: string;
  description: string;
  icon: string;
  ports: TemplatePort[];
  subgraph: unknown;
  usageCount?: number;
  updated_at?: string;
}

export interface TemplateUsage {
  procedureId: string;
  nodeId: string;
  groupPath: string[];
}

export interface TemplateNesting {
  templateId: string;
  nodeId: string;
  groupPath: string[];
}

export interface TemplateUsages {
  procedures: TemplateUsage[];
  templates: TemplateNesting[];
}

export interface ProcedureSummary {
  procedureId: string;
  name: string;
  status: "failing" | "degraded" | "healthy" | "paused" | "draft";
}

export interface UsageRow {
  kind: "procedure" | "template";
  id: string;
  first: TemplateUsage | TemplateNesting;
  count: number;
}

/** One line per procedure or template placing it, with how many times. */
export function usageRowsOf(usages: TemplateUsages): UsageRow[] {
  const rows = new Map<string, UsageRow>();
  for (const usage of usages.procedures) {
    const row = rows.get(`p:${usage.procedureId}`);
    if (row) row.count++;
    else
      rows.set(`p:${usage.procedureId}`, {
        kind: "procedure",
        id: usage.procedureId,
        first: usage,
        count: 1,
      });
  }
  for (const nesting of usages.templates) {
    const row = rows.get(`t:${nesting.templateId}`);
    if (row) row.count++;
    else
      rows.set(`t:${nesting.templateId}`, {
        kind: "template",
        id: nesting.templateId,
        first: nesting,
        count: 1,
      });
  }
  return [...rows.values()];
}

export function schemaTypeOf(p: TemplatePort): string {
  if (p.kind !== "data") return "—";
  const type = p.schema?.type;
  if (typeof type === "string") return type;
  if (Array.isArray(type)) return type.join(" | ");
  return "any";
}
