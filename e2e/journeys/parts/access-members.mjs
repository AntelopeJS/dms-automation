import { check, fixture, text } from "../../auto.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * Creates a member of the default tenant whose role holds the given permissions and signs them up.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The account name in the journey
 * @param {string[]} permissions The permissions of the member's role
 * @returns {Promise<{ roleId: string, userId: string }>} The ids
 */
export async function member(ctx, name, permissions) {
  const invite = await fixture(ctx, `invite ${name}`, "POST", "/member", { name, permissions });
  const email = text(invite.body, "email");
  const password = ctx.password();
  const signup = await ctx.api(`${name} signs up`, { method: "POST", path: "/api/auth/signup", body: { name, email, password, lang: "en", token: text(invite.body, "token") }, as: "anon" });
  const userId = text(signup.body, "user", "_id");
  ctx.addAccount(name, { email, password, userId });
  await ctx.verify(`${name} is a member`, [check("the signup answers a session", signup.status === 200 && userId !== "", signup.status)], { critical: true });
  return { roleId: text(invite.body, "roleId"), userId };
}
