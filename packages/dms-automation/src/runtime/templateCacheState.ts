import type { AutomationTemplateRow } from "../db/models/automation_template.model";

/**
 * Module-level cache of every workspace-global template. Populated by
 * hydrate() at boot and kept in sync by onTemplateChange / onTemplateDelete.
 * Read via the local `getTemplate` helper, which is handed to the executor as
 * the `TemplateCache` (see executeProcedure) consumed by resolveSubgraph.
 */
export const templateCache = new Map<string, AutomationTemplateRow>();

export function getTemplate(id: string): AutomationTemplateRow | undefined {
  return templateCache.get(id);
}

export const templates = { get: getTemplate };
