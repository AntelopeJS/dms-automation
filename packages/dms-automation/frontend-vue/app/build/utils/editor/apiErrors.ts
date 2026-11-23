import {
  isAbsentOr,
  isJsonValue,
  isList,
  isNumber,
  isRecord,
  isString,
  isStringList,
} from "../../../utils/json";
import type { JsonValue } from "../../../utils/json";
import type { GraphIssue } from "../../types/editor";

interface RefusalIssue {
  severity?: string;
  message?: string;
  code?: string;
  params?: Record<string, JsonValue>;
  nodeId?: string;
  path?: unknown[];
}

export interface SaveRefusal {
  data?: {
    issues?: Array<RefusalIssue | string>;
  };
}

interface TemplateIssue {
  path?: Array<string | number>;
  message?: string;
}

interface TemplateErrorData {
  error?: string;
  issues?: Array<TemplateIssue | string>;
  cycle?: string[];
}

function isJsonParams(value: unknown): value is Record<string, JsonValue> {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isRefusalIssue(value: unknown): value is RefusalIssue {
  return (
    isRecord(value) &&
    isAbsentOr(value.severity, isString) &&
    isAbsentOr(value.message, isString) &&
    isAbsentOr(value.code, isString) &&
    isAbsentOr(value.params, isJsonParams) &&
    isAbsentOr(value.nodeId, isString) &&
    isAbsentOr(value.path, isList)
  );
}

function isRefusalData(
  value: unknown,
): value is { issues: Array<RefusalIssue | string> } {
  return (
    isRecord(value) &&
    Array.isArray(value.issues) &&
    value.issues.every((issue) => isString(issue) || isRefusalIssue(issue))
  );
}

function isErrorWithData(error: unknown): error is { data: unknown } {
  return isRecord(error) && "data" in error;
}

function graphIssueOf(issue: RefusalIssue | string): GraphIssue {
  if (isString(issue)) return { severity: "error", message: issue };
  return {
    severity: issue.severity === "warning" ? "warning" : "error",
    message: issue.message ?? "",
    code: issue.code,
    params: issue.params,
    nodeId: issue.nodeId,
  };
}

/** Whether a refusal names a field of the body other than the graph (zod issues carry its path). */
function concernsOtherThanGraph(issue: RefusalIssue | string): boolean {
  return (
    !isString(issue) && Array.isArray(issue.path) && issue.path[0] !== "graph"
  );
}

function graphIssuesOf(
  issues: Array<RefusalIssue | string>,
): GraphIssue[] | null {
  return issues.some(concernsOtherThanGraph) ? null : issues.map(graphIssueOf);
}

function issuesOfData(data: unknown): GraphIssue[] | null {
  return isRefusalData(data) ? graphIssuesOf(data.issues) : null;
}

export function issuesOf(error: unknown): GraphIssue[] | null {
  return isErrorWithData(error) ? issuesOfData(error.data) : null;
}

function isTemplatePath(value: unknown): value is Array<string | number> {
  return (
    Array.isArray(value) &&
    value.every((part) => isString(part) || isNumber(part))
  );
}

function isTemplateIssue(value: unknown): value is TemplateIssue | string {
  if (isString(value)) return true;
  return (
    isRecord(value) &&
    isAbsentOr(value.path, isTemplatePath) &&
    isAbsentOr(value.message, isString)
  );
}

function isTemplateIssueList(
  value: unknown,
): value is Array<TemplateIssue | string> {
  return Array.isArray(value) && value.every(isTemplateIssue);
}

function isTemplateErrorData(value: unknown): value is TemplateErrorData {
  return (
    isRecord(value) &&
    isAbsentOr(value.error, isString) &&
    isAbsentOr(value.issues, isTemplateIssueList) &&
    isAbsentOr(value.cycle, isStringList)
  );
}

function templateIssueLine(issue: TemplateIssue | string): string {
  if (isString(issue)) return issue;
  const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
  const message = issue.message ?? "invalid";
  return path ? `${path}: ${message}` : message;
}

function describeTemplateError(data: TemplateErrorData): string | null {
  const head = data.error ?? "Request failed";
  if (data.issues && data.issues.length > 0)
    return `${head}\n${data.issues.map(templateIssueLine).join("\n")}`;
  if (data.cycle && data.cycle.length > 0)
    return `${head}: ${data.cycle.join(" → ")}`;
  return null;
}

function formatTemplateData(data: unknown): string | null {
  return isTemplateErrorData(data) ? describeTemplateError(data) : null;
}

/** Formats structured template validation issues and reference cycles. */
export function formatTemplateError(err: unknown): string | null {
  return isErrorWithData(err) ? formatTemplateData(err.data) : null;
}
