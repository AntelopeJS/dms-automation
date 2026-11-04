import { auto, same } from "../../auto.mjs";
import { declareFile, ledger, withConfig } from "../../procs.mjs";
import { actionNode, chainGraph, declareProcedure, logGraph, triggerNode } from "./interface-calls.mjs";
import { declaration, refusal, stored } from "./interface-declare-shared.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

export const startJourneys = [
  {
    id: "a-procedure-declared-from-start-is-created-then-kept-across-restarts",
    title: "a module declares procedures in start(): created on the first boot, kept on the next, with the user's edits and deletions deciding",
    entryPoint: "DeclareProcedure from start(), backend restart, GET /procedures/:id",
    async run(/** @type {Ctx} */ ctx) {
      const topic = ctx.unique("boot").replace(/\W+/g, "-");
      const declarations = [
        {
          id: "boot.armed",
          name: "Armed at boot é",
          description: "from start()",
          enabled: true,
          graph: chainGraph([triggerNode("ev", "verify.event", { topic }), actionNode("log", "log.message", { message: "boot" })]),
        },
        {
          id: "boot.draft",
          name: "Draft at boot",
          enabled: false,
          graph: logGraph("draft"),
        },
        {
          id: "boot.broken ",
          name: "Refused at boot",
          enabled: false,
          graph: logGraph("x"),
        },
      ];
      await withConfig(ctx, declareFile(ctx, declarations), async () => {
        const firstBoot = await ledger(ctx);
        const read = await stored(ctx, "boot.armed");
        await ctx.verify("first boot", [
          same(
            "the declarations ran in order and one was refused",
            firstBoot.entries.filter((entry) => String(entry.kind).startsWith("declare")).map((entry) => [entry.kind, entry.id, entry.status ?? null]),
            [
              ["declared", "boot.armed", "created"],
              ["declared", "boot.draft", "created"],
              ["declare-refused", "boot.broken ", null],
            ],
          ),
          same("the refusal's message", firstBoot.entries.find((entry) => entry.kind === "declare-refused")?.message, refusal("boot.broken ", "id: letters, digits, '.', '_' and '-' only")),
          same("stored once", [read?.name, read?.description, read?.enabled, read?.version], ["Armed at boot é", "from start()", true, 1]),
          same(
            "the enabled declaration is armed",
            firstBoot.entries.some((entry) => entry.kind === "activate" && entry.topic === topic),
            true,
          ),
        ]);
        await auto(ctx, "a user renames the draft", "PUT", "/procedures/boot.draft", {
          body: {
            name: "Renamed é",
            description: "",
            enabled: false,
            graph: logGraph("draft"),
            expectedRevision: 1,
          },
        });
        await auto(ctx, "a user deletes the armed one", "DELETE", "/procedures/boot.armed");
        await ctx.restartBackend();
        const secondBoot = await ledger(ctx);
        await ctx.verify("second boot", [
          same(
            "the existing procedure is kept, the deleted one created again",
            secondBoot.entries.filter((entry) => entry.kind === "declared").map((entry) => [entry.id, entry.status]),
            [
              ["boot.armed", "created"],
              ["boot.draft", "kept"],
            ],
          ),
          same("the user's rename stays", (await stored(ctx, "boot.draft"))?.name, "Renamed é"),
          same("the deleted one is back with its declaration", (await stored(ctx, "boot.armed"))?.name, "Armed at boot é"),
        ]);
        await ctx.restartBackend();
        const thirdBoot = await ledger(ctx);
        await ctx.verify("third boot", [
          same(
            "both are kept",
            thirdBoot.entries.filter((entry) => entry.kind === "declared").map((entry) => [entry.id, entry.status]),
            [
              ["boot.armed", "kept"],
              ["boot.draft", "kept"],
            ],
          ),
        ]);
      });
    },
  },
  {
    id: "a-declared-procedure-opens-in-the-builder-under-its-id",
    title: "the declared id is the procedure's id: the builder opens it at /modules/automation/builder?selected=<id>",
    entryPoint: "DeclareProcedure, /modules/automation/builder?selected=<id>",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Builder é");
      await declareProcedure(
        ctx,
        declaration("builder.opens-me", {
          name,
          graph: logGraph("Hello from code"),
        }),
      );
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/automation/builder?selected=builder.opens-me");
      await ctx.verify("the builder", [await tab.shows(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))), await tab.shows(/Log/)]);
    },
  },
];
