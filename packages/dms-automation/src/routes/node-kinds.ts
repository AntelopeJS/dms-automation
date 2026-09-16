import { Controller, Get } from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { nodeKinds } from "../runtime/nodeKinds";

/**
 * Surfaces the runtime's per-NodeKind metadata to the editor. The
 * frontend's GenericNode renderer reads each kind's `ui` block to
 * compute its layout (label, icon, port handles) without baking in
 * kind-specific knowledge.
 *
 * Kinds registered without a `ui` block (groupInput, groupOutput — they
 * have bespoke Vue components) are emitted as well; the editor just
 * skips the GenericNode path for them. The `group` kind is never emitted:
 * it isn't in the registry at all (flatten.ts handles it).
 */
@AuthOwnerOnly()
export class NodeKindsController extends Controller(
  "/api/automation/node-kinds",
) {
  @Get("")
  async list(@AuthRawUser() _user: User) {
    return nodeKinds.listAll();
  }
}
