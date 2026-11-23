import type {
  GroupPort,
  JsonSchema,
} from "../../../composables/useGraphConnect";

/** Handle style of a trigger port: the info role, the flow of control. */
export const triggerStyle = {
  background: "var(--ui-info)",
  width: "10px",
  height: "10px",
};

/** Handle style of a data port: the success role. */
export const dataStyle = {
  background: "var(--ui-success)",
  width: "8px",
  height: "8px",
};

const TYPE_COLORS = new Map([
  ["string", "var(--ui-success)"],
  ["number", "var(--ui-warning)"],
  ["integer", "var(--ui-warning)"],
  ["boolean", "var(--ui-error)"],
  ["object", "var(--ui-secondary)"],
  ["array", "var(--ui-info)"],
  ["null", "var(--ui-text-dimmed)"],
]);

function schemaType(schema: JsonSchema | undefined): string | undefined {
  const type: string | string[] | undefined = schema?.type;
  return [type].flat()[0];
}

/** Data handle style that picks a colour per JSON schema type of the port. */
export function dataHandleStyle(port: Pick<GroupPort, "schema">) {
  const color =
    TYPE_COLORS.get(schemaType(port.schema) ?? "") ?? "var(--ui-success)";
  return { background: color, width: "8px", height: "8px" };
}
