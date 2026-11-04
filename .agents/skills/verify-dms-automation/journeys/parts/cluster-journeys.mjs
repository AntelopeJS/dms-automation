import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { auto, check, fixture, list, same, text } from "../../auto.mjs";
import { ledger, runsOfProcedure, until, withConfig } from "../../procs.mjs";
import { chainGraph, actionNode, declareProcedure, triggerNode } from "./interface-calls.mjs";
import { MODULE, read } from "./package-files.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const STANDALONE = "[dms-automation] cluster mode: standalone (memory)";
const REDIS_WITHOUT_INTERFACE = "[dms-automation] cluster.driver=redis but @antelopejs/interface-redis is not provided; falling back to standalone (memory) mode";

/**
 * @param {Ctx} ctx The journey
 * @returns {string} The backend log's path
 */
function logPath(ctx) {
  return join(String(ctx.state.logs), "backend.log");
}

/**
 * @param {Ctx} ctx The journey
 * @returns {number} The backend log's size now
 */
function logSize(ctx) {
  return statSync(logPath(ctx)).size;
}

/**
 * @param {Ctx} ctx The journey
 * @param {number} from A size from `logSize`
 * @returns {string[]} The log lines written since, the continuation lines left out
 */
function linesSince(ctx, from) {
  return readFileSync(logPath(ctx))
    .subarray(from)
    .toString("utf8")
    .split("\n")
    .filter((line) => /^\[\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\] \[/.test(line));
}

/**
 * @param {string[]} lines Log lines
 * @param {string} message A message
 * @returns {string[]} The lines that carry it
 */
function carrying(lines, message) {
  return lines.filter((line) => line.endsWith(message));
}

/**
 * What a boot of the module logs about clustering, and what the singleton trigger does on it.
 *
 * @param {Ctx} ctx The journey
 * @param {string[]} lines The boot's log lines
 * @param {string} label The boot
 * @returns {Promise<import("../../auto.mjs").Check[]>} Checks that the boot is standalone
 */
async function standaloneBoot(ctx, lines, label) {
  const topic = ctx.unique(`leader-${label}`).replace(/\W+/g, "-");
  const id = `cluster.${label}`;
  await declareProcedure(ctx, {
    id,
    name: `Leader ${label}`,
    enabled: true,
    graph: chainGraph([triggerNode("ev", "verify.leader-event", { topic }), actionNode("log", "log.message", { message: "led" })]),
  });
  await fixture(ctx, "emit", "POST", "/emit", {
    topic,
    payload: { topic, value: "é" },
  });
  const runs = await until(
    () => runsOfProcedure(ctx, id),
    (rows) => rows.length >= 1,
  );
  const armed = (await ledger(ctx)).entries.filter((entry) => entry.kind === "activate" && entry.topic === topic).length;
  return [
    same(
      `${label}: the standalone line is logged once at info`,
      carrying(lines, STANDALONE).map((line) => /\[INFO\]/.test(line)),
      [true],
    ),
    same(
      `${label}: no redis mode, no leader election line`,
      lines.filter((line) => /cluster mode: redis|leader/i.test(line)),
      [],
    ),
    same(`${label}: a singleton trigger is armed here at once (the instance is the leader)`, armed, 1),
    same(`${label}: and it fires`, runs.length, 1),
  ];
}

export const clusterJourneys = [
  {
    id: "cluster-driver-auto-runs-standalone-without-redis",
    title: "by default, and with cluster.driver auto, the module runs standalone when no module provides @antelopejs/interface-redis: it logs `cluster mode: standalone (memory)` and this instance owns every trigger, singleton ones included",
    entryPoint: "backend log at start, cluster.driver unset and auto, verify.leader-event",
    async run(/** @type {Ctx} */ ctx) {
      const whole = readFileSync(logPath(ctx), "utf8").split("\n");
      const lastBoot =
        whole
          .map((line, index) => (line.includes("[dms-automation] registered built-ins") ? index : -1))
          .filter((index) => index >= 0)
          .at(-1) ?? 0;
      const bootLines = whole.slice(lastBoot).filter((line) => line.includes("[dms-automation]"));
      await ctx.verify("the default boot", [
        same("the standalone line is logged once by the last boot", carrying(bootLines, STANDALONE).length, 1),
        same(
          "no warning about redis",
          bootLines.filter((line) => line.includes("cluster.driver=redis")),
          [],
        ),
      ]);
      const before = logSize(ctx);
      await withConfig(ctx, { VERIFY_AUTO_CLUSTER_DRIVER: "auto" }, async () => {
        const lines = linesSince(ctx, before).filter((line) => line.includes("[dms-automation]"));
        await ctx.verify("driver auto", await standaloneBoot(ctx, lines, "auto"));
      });
    },
  },
  {
    id: "cluster-driver-memory-runs-standalone-and-says-nothing-more",
    title: "cluster.driver memory is standalone: it logs `cluster mode: standalone (memory)` and no warning",
    entryPoint: "backend log at start, cluster.driver memory",
    async run(/** @type {Ctx} */ ctx) {
      const before = logSize(ctx);
      await withConfig(ctx, { VERIFY_AUTO_CLUSTER_DRIVER: "memory" }, async () => {
        const lines = linesSince(ctx, before).filter((line) => line.includes("[dms-automation]"));
        await ctx.verify("driver memory", [
          ...(await standaloneBoot(ctx, lines, "memory")),
          same(
            "no warning is logged",
            lines.filter((line) => /\[WARN\]/.test(line)),
            [],
          ),
          same(
            "nothing about redis",
            lines.filter((line) => /redis/i.test(line)),
            [],
          ),
        ]);
      });
    },
  },
  {
    id: "cluster-driver-redis-without-the-interface-warns-and-runs-standalone",
    title: "cluster.driver redis with no module providing @antelopejs/interface-redis logs a warning and runs standalone",
    entryPoint: "backend log at start, cluster.driver redis",
    async run(/** @type {Ctx} */ ctx) {
      const before = logSize(ctx);
      await withConfig(ctx, { VERIFY_AUTO_CLUSTER_DRIVER: "redis" }, async () => {
        const lines = linesSince(ctx, before).filter((line) => line.includes("[dms-automation]"));
        const warning = carrying(lines, REDIS_WITHOUT_INTERFACE);
        const order = lines.findIndex((line) => line.endsWith(REDIS_WITHOUT_INTERFACE)) < lines.findIndex((line) => line.endsWith(STANDALONE));
        await ctx.verify("driver redis", [
          same(
            "one warning, at warn level, with the documented text",
            warning.map((line) => /\[WARN\]/.test(line)),
            [true],
          ),
          check(
            "the warning comes before the mode line",
            order,
            lines.map((line) => line.slice(0, 160)),
          ),
          ...(await standaloneBoot(ctx, lines, "redis")),
        ]);
      });
    },
  },
  {
    id: "the-library-shows-each-trigger-with-its-cluster-mode",
    title: "the Library shows each trigger's cluster mode after its id and as Replicated across instances or Runs on one instance",
    entryPoint: "GET /trigger-types, /modules/automation/library",
    async run(/** @type {Ctx} */ ctx) {
      const types = list((await auto(ctx, "trigger types", "GET", "/trigger-types")).body);
      /** @param {string} id */
      const modeOf = (id) =>
        text(
          types.find((row) => row.id === id),
          "cluster",
        );
      await ctx.verify("the modes by trigger id", [
        same("the documented ones", ["schedule.cron", "webhook", "manual", "verify.event", "verify.leader-event"].map(modeOf), ["singleton", "replicated", "replicated", "replicated", "singleton"]),
        same(
          "every trigger has one of the two modes",
          types.filter((row) => !["singleton", "replicated"].includes(String(row.cluster))).map((row) => row.id),
          [],
        ),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/automation/library");
      const cases = [
        {
          name: /^Manual /,
          id: "manual",
          mode: "replicated",
          card: /Replicated across instances\s+Every automation instance listens; each call is handled by exactly one of them\./,
        },
        {
          name: /^Schedule \(cron\) /,
          id: "schedule.cron",
          mode: "singleton",
          card: /Runs on one instance/,
        },
        {
          name: /^Webhook /,
          id: "webhook",
          mode: "replicated",
          card: /Replicated across instances/,
        },
        {
          name: /^Fixture leader event /,
          id: "verify.leader-event",
          mode: "singleton",
          card: /Runs on one instance/,
        },
      ];
      for (const entry of cases) {
        await tab.click({ role: "button", name: entry.name });
        await ctx.verify(`${entry.id} in the Library`, [await tab.shows(new RegExp(`id · ${entry.id.replace(/\./g, "\\.")} · cluster · ${entry.mode}`)), await tab.shows(entry.card)]);
        await tab.click({ role: "button", name: "Back to the list" });
      }
    },
  },
  {
    id: "the-leadership-numbers-in-the-docs-are-the-ones-of-the-code",
    title: "the 30-second lock TTL, the 10-second renew interval and the hourly purge the cluster docs and the FAQ state are what the leader and the retention code use",
    entryPoint: "docs/3.configuration.md Clustering, docs/6.faq.md against src/cluster/leader.ts and src/runtime/retention.ts",
    async run(/** @type {Ctx} */ ctx) {
      const leader = read(ctx, `${MODULE}/src/cluster/leader.ts`);
      const retention = read(ctx, `${MODULE}/src/runtime/retention.ts`);
      const config = read(ctx, `${MODULE}/docs/3.configuration.md`);
      const faq = read(ctx, `${MODULE}/docs/6.faq.md`);
      const ttl = Number(/TTL_MS = ([\d_]+)/.exec(leader)?.[1]?.replace(/_/g, ""));
      const divisor = Number(/TICK_MS = TTL_MS \/ (\d+)/.exec(leader)?.[1]);
      await ctx.verify("the leadership numbers", [
        same("the docs' TTL", Number(/(\d+)-second TTL/.exec(config)?.[1]), ttl / 1000),
        same("the docs' renew interval", Number(/renews every (\d+) seconds/.exec(config)?.[1]), ttl / divisor / 1000),
        same("the docs' warning repeats both", [/up to the 30-second lock TTL/.test(config), /up to one renew interval/.test(config)], [true, true]),
        same("the purge runs every hour, as the docs say", [/PURGE_INTERVAL_MS = MS_PER_HOUR/.test(retention), /every hour after/.test(config), /deletes older runs every hour/.test(faq)], [true, true, true]),
      ]);
    },
  },
];
