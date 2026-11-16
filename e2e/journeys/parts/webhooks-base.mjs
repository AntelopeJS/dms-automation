import { auto, pick } from "../../auto.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * The origin webhooks are shown on, as the Library and the Builder read it.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<{ url: unknown, configured: unknown, status: number | null }>} The answer
 */
export async function webhookBase(ctx) {
  const answer = await auto(ctx, "the webhook base", "GET", "/library/webhook-base");
  return { url: pick(answer.body, "url"), configured: pick(answer.body, "configured"), status: answer.status };
}

/**
 * Restarts the backend once per `apiBaseUrl` setting (`default`, `empty` or a URL, see `VERIFY_AUTO_API_BASE_URL`),
 * runs `body` with each, and restarts it again without the setting.
 *
 * @param {Ctx} ctx The journey
 * @param {string[]} settings The settings, one backend start each
 * @param {(setting: string) => Promise<void>} body What to do with each setting in force
 * @returns {Promise<void>}
 */
export async function withApiBase(ctx, settings, body) {
  const previous = { ...ctx.state.extraEnv };
  try {
    for (const setting of settings) {
      ctx.state.extraEnv = { ...previous, VERIFY_AUTO_API_BASE_URL: setting };
      await ctx.restartBackend();
      await body(setting);
    }
  } finally {
    ctx.state.extraEnv = previous;
    await ctx.restartBackend();
  }
}
