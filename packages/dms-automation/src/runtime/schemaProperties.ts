import type { DataValue } from "../types/dataValue";

/** What the runtime reads of one property of a node's JSON Schema. */
export interface SchemaProperty {
  title?: string;
  minimum?: number;
  maximum?: number;
  enum?: DataValue[];
  default?: DataValue;
  "x-redact"?: string;
}
