import { guarded } from "../guard.mjs";
import { auto, check, pick, raw, same, text } from "../auto.mjs";
import { createProcedure, manualLog, runNow, withConfig } from "../procs.mjs";
import { insertRuns, MS_PER_HOUR, openPage, runDocument, runTable, textWhen, twoStepProcedure } from "./parts/runs-common.mjs";
import { listJourneys } from "./parts/runs-list.mjs";
import { pageJourneys } from "./parts/runs-page.mjs";
import { drawerWidthJourneys } from "./parts/runs-drawer-width.mjs";
import { holdJourneys } from "./parts/runs-hold.mjs";

/** @typedef {import("../auto.mjs").Ctx} Ctx */

export const journeys = guarded([
  ...listJourneys,
  ...pageJourneys,
  ...drawerWidthJourneys,
  ...holdJourneys,
  {
    id: "run-routes-refuse-an-unknown-run-and-odd-methods",
    title: "an unknown run id answers 404 `run \"<id>\" not found` on the run, its log, its re-run confirmation and its re-run; an unknown KPI metric answers 404; the run routes accept only the documented methods",
    entryPoint: "GET /runs/:id, GET /runs/:id/logs, GET /runs/:id/rerun-confirm, POST /runs/:id/rerun, GET /runs/kpi/:metric",
    async run(/** @type {Ctx} */ ctx) {
      const id = await twoStepProcedure(ctx, ctx.unique("Odd"));
      const ran = await runNow(ctx, id, {});
      const bad = "no-such-run";
      const reads = {
        run: await auto(ctx, "unknown run", "GET", `/runs/${encodeURIComponent(bad)}`),
        logs: await auto(ctx, "unknown log", "GET", `/runs/${encodeURIComponent(bad)}/logs`),
        confirm: await auto(ctx, "unknown confirm", "GET", `/runs/${encodeURIComponent(bad)}/rerun-confirm`),
        rerun: await auto(ctx, "unknown rerun", "POST", `/runs/${encodeURIComponent(bad)}/rerun`),
        metric: await auto(ctx, "unknown metric", "GET", "/runs/kpi/nonsense"),
      };
      await ctx.verify("unknown run ids", [
        same("run 404", [reads.run.status, text(reads.run.body, "error")], [404, `run "${bad}" not found`]),
        same("logs 404", [reads.logs.status, text(reads.logs.body, "error")], [404, `run "${bad}" not found`]),
        same("rerun-confirm 404", [reads.confirm.status, text(reads.confirm.body, "error")], [404, `run "${bad}" not found`]),
        same("rerun 404", [reads.rerun.status, text(reads.rerun.body, "error")], [404, `run "${bad}" not found`]),
        same("unknown metric 404", [reads.metric.status, text(reads.metric.body, "error")], [404, 'unknown metric "nonsense"']),
      ]);
      /** @type {[string, string, number | null][]} */
      const odd = [];
      for (const [method, path] of [["PUT", `/api/automation/runs/${ran.runId}`], ["DELETE", `/api/automation/runs/${ran.runId}`], ["PATCH", `/api/automation/runs/${ran.runId}/rerun`], ["GET", `/api/automation/runs/${ran.runId}/rerun`], ["POST", `/api/automation/runs/${ran.runId}/logs`], ["POST", "/api/automation/runs/kpi/runs"]]) {
        const answer = await raw(ctx, `${method} ${path}`, { path, method, as: "admin" });
        odd.push([method, path.replace(ran.runId, "<id>"), answer.status]);
      }
      await ctx.verify("methods the docs do not give a run are refused", [check("none of them is served as a 2xx", odd.every(([, , status]) => status !== null && status >= 400), odd)]);
      const head = await raw(ctx, "HEAD the run", { path: `/api/automation/runs/${ran.runId}`, method: "HEAD", as: "admin" });
      const options = await raw(ctx, "OPTIONS the run", { path: `/api/automation/runs/${ran.runId}`, method: "OPTIONS", as: "admin" });
      await ctx.verify("HEAD and OPTIONS", [check("HEAD never answers 5xx", head.status !== null && head.status < 500, head.status), check("OPTIONS never answers 5xx", options.status !== null && options.status < 500, options.status)]);
      const anon = await auto(ctx, "run as nobody", "GET", `/runs/${ran.runId}`, { as: "anon" });
      await ctx.verify("a run is the owner's", [same("anonymous gets 401", anon.status, 401)]);
    },
  },
  {
    id: "the-retention-footer-says-how-long-runs-are-kept",
    title: "the footer of the Run history says Runs are kept 30 days by default and with a retentionDays of 30, Runs are kept forever with 0, and Older runs are deleted after the retention period set for this project with any other value",
    entryPoint: "/modules/automation/runs, runs.retentionDays",
    async run(/** @type {Ctx} */ ctx) {
      const footer = async (/** @type {string} */ label, /** @type {RegExp} */ ready) => {
        const { tab, text: shown } = await openPage(ctx, "/modules/automation/runs", /Run history/);
        const settled = await textWhen(tab, ready, 45_000);
        await tab.close();
        return { label, shown: settled || shown };
      };
      const lines = (/** @type {string} */ body) => body.split("\n").map((line) => line.trim()).filter((line) => /^(Runs are kept|Older runs are deleted)/.test(line));
      const aged = await twoStepProcedure(ctx, ctx.unique("Footer"));
      await runNow(ctx, aged, {});
      const byDefault = await footer("default", /Runs are kept 30 days/);
      /** @type {Record<string, string[]>} */
      const seen = { default: lines(byDefault.shown) };
      for (const [days, ready] of [["30", /Runs are kept 30 days/], ["0", /Runs are kept forever/], ["7", /Older runs are deleted after/], ["395", /Older runs are deleted after/]]) {
        await withConfig(ctx, { VERIFY_AUTO_RETENTION_DAYS: days }, async () => {
          const answer = await footer(days, ready);
          seen[days] = lines(answer.shown);
        });
      }
      await ctx.verify("the footer sentence by configuration", [
        same("default (no runs.retentionDays)", seen.default, ["Runs are kept 30 days"]),
        same("retentionDays 30", seen["30"], ["Runs are kept 30 days"]),
        same("retentionDays 0", seen["0"], ["Runs are kept forever"]),
        same("retentionDays 7", seen["7"], ["Older runs are deleted after the retention period set for this project"]),
        same("retentionDays 395", seen["395"], ["Older runs are deleted after the retention period set for this project"]),
      ]);
    },
  },
  {
    id: "the-run-figures-count-runs-success-rate-failed-and-p95-against-the-compared-window",
    title: "the Runs, Success rate, Failed and p95 figures count production runs of every procedure in the window and give the change against the compared window; test runs never count",
    entryPoint: "GET /runs/kpi/:metric, /modules/automation/runs",
    async run(/** @type {Ctx} */ ctx) {
      const a = await createProcedure(ctx, { name: ctx.unique("Figures A"), graph: manualLog("a") });
      const b = await createProcedure(ctx, { name: ctx.unique("Figures B"), graph: manualLog("b") });
      const now = Date.now();
      const current = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
      const docs = current.map((duration, index) =>
        runDocument({ procedureId: index % 2 ? a : b, procedureName: index % 2 ? "A" : "B", startedAt: new Date(now - 2 * MS_PER_HOUR - index * 60_000), durationMs: duration, status: index < 5 ? "failed" : "ok", errorMessage: index < 5 ? "x" : undefined }),
      );
      docs.push(runDocument({ procedureId: a, procedureName: "A", startedAt: new Date(now - 3 * MS_PER_HOUR), durationMs: 9999, kind: "test", status: "failed", errorMessage: "test failure" }));
      docs.push(runDocument({ procedureId: b, procedureName: "B", startedAt: new Date(now - 70 * MS_PER_HOUR), durationMs: 7 }));
      for (let index = 0; index < 10; index += 1) {
        docs.push(runDocument({ procedureId: a, procedureName: "A", startedAt: new Date(now - 30 * MS_PER_HOUR - index * 60_000), durationMs: 100, status: index < 1 ? "failed" : "ok", errorMessage: index < 1 ? "y" : undefined }));
      }
      await insertRuns(ctx, docs);
      const from = new Date(now - 24 * MS_PER_HOUR).toISOString();
      const to = new Date(now + 60_000).toISOString();
      const compareFrom = new Date(now - 48 * MS_PER_HOUR).toISOString();
      const compareTo = new Date(now - 24 * MS_PER_HOUR - 1).toISOString();
      const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&compareFrom=${encodeURIComponent(compareFrom)}&compareTo=${encodeURIComponent(compareTo)}`;
      const read = async (/** @type {string} */ metric, /** @type {string} */ extra = query) => (await auto(ctx, `kpi ${metric}`, "GET", `/runs/kpi/${metric}?${extra}`)).body;
      const runs = await read("runs");
      const rate = await read("success-rate");
      const failed = await read("failed");
      const p95 = await read("duration-p95");
      const none = await read("runs", `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&comparison=none&compareFrom=${encodeURIComponent(compareFrom)}&compareTo=${encodeURIComponent(compareTo)}`);
      const figureOf = (/** @type {unknown} */ body) => [pick(body, "value"), pick(body, "previousValue"), pick(body, "delta")];
      await ctx.verify("the four figures with their change", [
        same("Runs: 20 now, 10 before, +100%", figureOf(runs), [20, 10, 100]),
        same("Success rate: 15 of 20 now (75), 9 of 10 before (90), -16.7%", figureOf(rate), [75, 90, -16.7]),
        same("Failed: 5 now, 1 before, +400%", figureOf(failed), [5, 1, 400]),
        same("p95: nearest rank of 20 durations is the 19th (190), before 100, +90%", figureOf(p95), [190, 100, 90]),
        same("comparison none leaves out the previous value", figureOf(none), [20, undefined, undefined]),
      ]);
      const tab = (await openPage(ctx, "/modules/automation/runs", /Run history/)).tab;
      const shown = await textWhen(tab, /RUNS\s+20\s/i, 40_000);
      const flat = shown.replace(/\s+/g, " ");
      const figure = (/** @type {RegExp} */ pattern) => pattern.exec(flat)?.[1];
      await ctx.verify("the page shows the same figures", [
        same("Runs", figure(/RUNS (\d+)/i), "20"),
        same("Success rate", figure(/SUCCESS RATE ([\d.]+%)/i), "75%"),
        same("Failed", figure(/FAILED (\d+) /i), "5"),
        same("p95 (ms)", figure(/P95 \(MS\) (\d+)/i), "190"),
        same("the list holds the test run and the older runs: 32 rows", (await runTable(ctx)).total, 32),
      ]);
    },
  },
]);
