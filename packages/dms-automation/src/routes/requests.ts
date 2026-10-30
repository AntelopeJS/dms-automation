import { HTTPResult } from "@antelopejs/interface-api";
import type { z } from "zod";
import type { GraphIssue } from "../runtime/graphIssues";
import type { DataValue } from "../types/dataValue";

/** Prefix of the i18n keys the routes answer refusals with. */
export const API_MESSAGES = "$dms_automation.api";

const NON_NEGATIVE_INT = /^\d+$/;

/**
 * A refused request: `error` for developers, `message` (an i18n key) for the
 * toast the DMS shows in place of a generic "something went wrong".
 */
export function refused(
  status: number,
  error: string,
  message: string,
  details: { issues?: RefusedIssues } = {},
): HTTPResult {
  return new HTTPResult(status, { error, message, ...details });
}

/** The issues a refused body lists: those of its schema or of its graph. */
type RefusedIssues = z.ZodIssue[] | GraphIssue[];

/** A refused body, its issues listed. */
export function invalid(
  error: string,
  issues: RefusedIssues,
  message = `${API_MESSAGES}.invalidBody`,
): HTTPResult {
  return refused(400, error, message, { issues });
}

export function parseBody<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  body: DataValue,
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw invalid("invalid body", parsed.error.issues);
  return parsed.data;
}

/** How many rows a page of a list holds when the query does not say, and at most. */
interface PageSizes {
  defaultSize: number;
  maxSize: number;
}

const DEFAULT_SIZES: PageSizes = { defaultSize: 20, maxSize: 200 };

/** The rows a page of a list holds, and which page. */
interface PageRequest {
  page: number;
  limit: number;
}

/**
 * A page of a list from its query: `page` from 0, `limit` rows from 1, a
 * larger limit read as the largest page served. Anything else is a 400.
 */
export function pageParams(
  page?: string,
  limit?: string,
  { defaultSize, maxSize }: PageSizes = DEFAULT_SIZES,
): PageRequest {
  const valid =
    (!page || NON_NEGATIVE_INT.test(page)) &&
    (!limit || (NON_NEGATIVE_INT.test(limit) && Number(limit) >= 1));
  if (!valid) {
    throw refused(
      400,
      "page must be an integer >= 0 and limit an integer >= 1",
      `${API_MESSAGES}.invalidPage`,
    );
  }
  return {
    page: page ? Number(page) : 0,
    limit: Math.min(limit ? Number(limit) : defaultSize, maxSize),
  };
}
