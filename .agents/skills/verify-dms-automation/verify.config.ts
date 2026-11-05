/** A kind of one-way door. */
export type DoorKind = "data" | "format" | "contract" | "outbound" | "exposure" | "publish";

/** Path rules for one door kind: globs and declared funnel modules. */
export interface DoorRule {
  globs: string[];
  funnels: string[];
  why: string;
}

/**
 * How the gate decides whether a diff changed what the covered code does:
 * `emit` compares the JavaScript statements of the covered files on the
 * base and on HEAD (types, comments, formatting, imports and export
 * keywords left out); `probe` runs a command on a checkout of each, the
 * checkout's path as last argument, and compares what it prints.
 */
export type Behaviour = { kind: "emit" } | { kind: "probe"; command: string[] };

/**
 * A formal check: the source files it covers, the check's own files, the
 * command that runs it, how its output names a violated and a passing rule,
 * how the gate decides that a diff changed the covered behaviour, and the
 * command run on the base when it did or when the check's own files changed
 * (`command` when absent).
 */
export interface FormalCheck {
  name: string;
  covers: string[];
  files: string[];
  command: string[];
  baseCommand?: string[];
  violation: RegExp | null;
  passing: RegExp | null;
  behaviour: Behaviour;
}

/** The repo-owned layer of the verification skill, read by `dms-control`. */
export interface VerifyConfig {
  playground: string;
  prepare: string[][];
  userFacing: string[];
  notUserFacing: string[];
  smoke: string;
  smokeJourney: string;
  doors: Record<DoorKind, DoorRule | null>;
  formal: FormalCheck[];
}

const SKILL = ".agents/skills/verify-dms-automation";
const MODULE = "packages/dms-automation";
const INTERFACE = "packages/interface-dms-automation";

const config: VerifyConfig = {
  playground: `${SKILL}/playground`,
  prepare: [
    ["pnpm", "install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
    ["pnpm", "run", "build"],
    ["npm", "install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "--prefix", SKILL, "playwright-core@1.56.1"],
    ["ln", "-sfn", `../../../../${MODULE}/node_modules`, `${SKILL}/playground/node_modules`],
    ["node", `${SKILL}/fetch-api.mjs`],
    [`${MODULE}/node_modules/.bin/tsc`, "-p", `${SKILL}/playground/tsconfig.build.json`],
  ],
  userFacing: [`${MODULE}/src/**`, `${MODULE}/frontend-vue/**`, `${MODULE}/skills/**`, `${MODULE}/package.json`, `${INTERFACE}/src/**`, `${INTERFACE}/skills/**`, `${INTERFACE}/package.json`],
  notUserFacing: [`${MODULE}/frontend-vue/tests/**`, `${MODULE}/frontend-vue/.*`, `${MODULE}/frontend-vue/eslint.config.mjs`, `${MODULE}/frontend-vue/eslint-rules/**`, `${MODULE}/frontend-vue/pnpm-lock.yaml`],
  smoke: "smoke",
  smokeJourney: "onboard, create a procedure with a Manual trigger and a Log action, run it, read its trace and its place in the run history",
  doors: {
    data: {
      globs: [
        `${MODULE}/src/runtime/retention.ts`,
        `${MODULE}/src/routes/procedures.ts`,
        `${MODULE}/src/routes/templates.ts`,
        `${MODULE}/src/routes/deleteConfirm.ts`,
        `${MODULE}/src/runtime/templateUsages.ts`,
        `${MODULE}/src/data/procedures-table.ts`,
        `${MODULE}/src/data/runs-table.ts`,
      ],
      funnels: [],
      why: "these delete procedures, templates and runs, or rewrite a stored graph, which a revert of the code does not bring back",
    },
    format: {
      globs: [`${MODULE}/src/db/**`, `${MODULE}/src/types/graph.ts`, `${MODULE}/src/types/runLog.ts`, `${MODULE}/src/runtime/graphVersion.ts`, `${MODULE}/src/runtime/boundRunLog.ts`],
      funnels: [],
      why: "the procedure, run and template tables, the stored graph and the run log are read back by the next version of the module",
    },
    contract: {
      globs: [`${MODULE}/package.json`, `${MODULE}/src/routes/**`, `${MODULE}/src/index.ts`, `${INTERFACE}/package.json`, `${INTERFACE}/src/**`, `${MODULE}/frontend-vue/package.json`],
      funnels: [],
      why: "other modules import the interface, scripts call the HTTP routes, and projects set the config keys, the node ids and the renderer range",
    },
    outbound: {
      globs: [`${MODULE}/src/runtime/builtins/actions/http.ts`, `${MODULE}/src/runtime/builtins/triggers/cron.ts`, `${MODULE}/src/runtime/executor.ts`, `${MODULE}/src/runtime/sideEffects.ts`, `${MODULE}/src/routes/procedureRuns.ts`, `${MODULE}/src/runtime/runProcedure.ts`],
      funnels: [],
      why: "the HTTP request action, schedules and run-now call outside services and act for real, which no rollback undoes",
    },
    exposure: {
      globs: [`${MODULE}/src/runtime/builtins/triggers/webhook.ts`, `${MODULE}/src/runtime/webhookRoutes.ts`, `${MODULE}/src/runtime/builtins/actions/http.ts`, `${MODULE}/src/routes/index.ts`, `${MODULE}/src/runtime/boundRunLog.ts`],
      funnels: [],
      why: "webhooks answer without a session, every other route is the platform owner's alone, and the stored run copies of requests carry credentials unless redacted",
    },
    publish: {
      globs: [`${MODULE}/package.json`, `${INTERFACE}/package.json`, `${MODULE}/.release-it.json`, `${MODULE}/changelogen.config.json`, ".github/workflows/release.yml", ".github/workflows/release-interface.yml"],
      funnels: [],
      why: "the package names, their files and the release workflows claim @antelopejs/dms-automation and @antelopejs/interface-dms-automation in the npm registry",
    },
  },
  formal: [
    {
      name: "formal-leader-triggers",
      covers: [`${MODULE}/src/cluster/leader.ts`, `${MODULE}/src/runtime/subscriptions.ts`, `${MODULE}/src/runtime/reconcile.ts`, `${MODULE}/src/index.ts`],
      files: [".agents/skills/formal-leader-triggers/**"],
      command: ["node", ".agents/skills/formal-leader-triggers/check.mjs", "--full"],
      baseCommand: ["node", ".agents/skills/formal-leader-triggers/check.mjs"],
      violation: /^(?:finding|BROKEN|CHANGED|HOLDS) +(\w+)/gm,
      passing: /(?<=^holds +(?:\w+, )*)(\w+)(?=,| \()/gm,
      behaviour: { kind: "emit" },
    },
  ],
};

export default config;
