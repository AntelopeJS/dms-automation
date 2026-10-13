import { z } from "zod";
import { procedureGraphSchema } from "./graphSchema";

/** The bodies the procedures routes accept. */

export const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);
const descriptionSchema = z.string().max(MAX_DESCRIPTION_LENGTH);

/**
 * A save names the revision it was loaded at: a procedure written since
 * (another tab, a pause from the list) is not overwritten.
 */
export const procedureUpdateSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  enabled: z.boolean(),
  graph: procedureGraphSchema,
  expectedRevision: z.number().int(),
});

export const STARTERS = ["webhook", "schedule.cron", "manual"] as const;

export type Starter = (typeof STARTERS)[number];

export const newProcedureSchema = z.object({
  name: nameSchema,
  trigger: z.enum(STARTERS),
  description: descriptionSchema.nullish(),
});

export const importSchema = z.object({ json: z.string().min(1) });

export const exportedSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  graph: procedureGraphSchema,
});

/**
 * Pause or resume. `restorePause` (undoing a resume) keeps the time and
 * author of the pause the resume ended.
 */
export const enabledSchema = z.object({
  enabled: z.boolean(),
  restorePause: z.boolean().optional(),
});

export const validateSchema = z.object({
  graph: procedureGraphSchema,
  enabled: z.boolean().optional(),
  procedureId: z.string().optional(),
  name: z.string().optional(),
});

export const runNowSchema = z
  .object({
    payload: z.unknown().optional(),
    triggerNodeId: z.string().optional(),
  })
  .nullish();

export const testSchema = z.object({
  graph: procedureGraphSchema,
  payload: z.unknown().optional(),
  triggerNodeId: z.string().optional(),
});

const IMPORT = "$dms_automation.importProcedure";

/**
 * Why an import is not a procedure, for the field under the JSON, as a key
 * the form translates (it passes no parameters): no name or no graph, a step
 * kind this installation does not have, or a graph of another shape.
 */
export function importErrorOf(issues: z.ZodIssue[]): string {
  const missing = issues.some(
    (i) =>
      i.path.length === 1 &&
      i.code === "invalid_type" &&
      i.received === "undefined",
  );
  if (missing || issues.length === 0) return `${IMPORT}.notProcedure`;
  const unknownKind = issues.some((i) => i.path.at(-1) === "kind");
  return unknownKind ? `${IMPORT}.unknownKind` : `${IMPORT}.invalidGraph`;
}
