export const FRONTEND_MODULE_NAME = "@antelopejs/dms-automation-frontend-vue";
export const DATABASE_NAME = "dms-automation";
export const SCHEMA_NAME = "dms_automation";

/**
 * Pagination limit used when a caller needs *every* row (stats aggregation,
 * template-cache hydration, usage scans). The list APIs are page-based, so a
 * large limit stands in for "no limit" — comfortably above any realistic row
 * count for these tables.
 */
export const FETCH_ALL_LIMIT = 100000;

/** Milliseconds in an hour and a day — shared by run-window math. */
export const MS_PER_HOUR = 60 * 60 * 1000;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
