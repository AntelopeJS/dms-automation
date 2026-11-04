import { auto, check, same, text } from "../../auto.mjs";
import { boundingBox } from "./overview-page.mjs";
import { insertRuns, openPage, runDocument, textWhen, twoStepProcedure } from "./runs-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Tab} Tab */

const DRAG_PX = 200;

/**
 * @param {Tab} tab The tab on the Run history with a run open
 * @returns {Promise<number>} The width of the open drawer in pixels
 */
async function drawerWidth(tab) {
  return tab.page.getByRole("dialog").first().evaluate((element) => Math.round(element.getBoundingClientRect().width));
}

export const drawerWidthJourneys = [
  {
    id: "the-drawer-opens-again-at-the-width-it-was-dragged-to",
    title: "dragging the drawer's inner edge widens it, and it opens again at that width after it is closed and after a reload",
    entryPoint: "/modules/automation/runs?record=<id>, the drawer's separator",
    async run(/** @type {Ctx} */ ctx) {
      const id = await twoStepProcedure(ctx, ctx.unique("Width"));
      const procedureName = text((await auto(ctx, "read", "GET", `/procedures/${id}`)).body, "name");
      const spec = [0, 1].map((i) => runDocument({ procedureId: id, procedureName, startedAt: new Date(Date.now() - (i + 1) * 60_000) }));
      await insertRuns(ctx, spec);
      const first = String(spec[0]?._id);
      const { tab } = await openPage(ctx, `/modules/automation/runs?record=${first}`, /Run history/);
      await textWhen(tab, /Run 1 of 2/, 40_000);
      await textWhen(tab, /Open trace\s+Debug in builder/, 60_000);
      const before = await drawerWidth(tab);
      const grip = tab.page.getByRole("separator", { name: "Resize the drawer" });
      const at = await boundingBox(grip);
      if (!at) throw new Error("NOT VERIFIED: the drawer has no resize separator");
      const x = at.x + at.width / 2;
      const y = at.y + at.height / 2;
      await tab.page.mouse.move(x, y);
      await tab.page.mouse.down();
      await tab.page.mouse.move(x - DRAG_PX, y, { steps: 12 });
      await tab.page.mouse.up();
      await tab.page.waitForTimeout(600);
      const dragged = await drawerWidth(tab);
      await ctx.verify("dragging the edge widens the drawer", [check(`the drawer is about ${DRAG_PX} px wider`, dragged - before >= DRAG_PX - 40 && dragged - before <= DRAG_PX + 40, `${before} px, then ${dragged} px`)]);
      await tab.page.keyboard.press("Escape");
      await tab.page.waitForTimeout(800);
      await tab.goto(`/modules/automation/runs?record=${first}`);
      await textWhen(tab, /Run 1 of 2/, 40_000);
      await textWhen(tab, /Open trace\s+Debug in builder/, 60_000);
      const reopened = await drawerWidth(tab);
      await ctx.verify("it opens again at that width", [same("the width after closing and a reload", reopened, dragged)]);
    },
  },
];
