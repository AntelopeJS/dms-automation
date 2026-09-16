/**
 * Single load point for built-in node-kind registration and the
 * trigger/action/data type catalogs. Side-effectful imports run each
 * `nodes/<kind>.ts` file, which calls `nodeKinds.register(...)` on load.
 *
 * Order within `nodes/` is unimportant — registration is position-
 * independent — but the import order below is preserved roughly by
 * category for readability.
 */

import "./nodes/trigger";
import "./nodes/action";
import "./nodes/data";
import "./nodes/if";
import "./nodes/switch";
import "./nodes/delay";
import "./nodes/setVariable";
import "./nodes/foreach";
import "./nodes/forRange";
import "./nodes/tryCatch";
import "./nodes/retry";
import "./nodes/parallel";
import "./nodes/groupInput";
import "./nodes/groupOutput";

export { builtinActions } from "./actions";
export { builtinDataNodes } from "./data";
export { builtinTriggers } from "./triggers";
