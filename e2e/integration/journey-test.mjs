import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { apiRequest, onboard, startRun } from "@antelopejs/dms/e2e/run";
import {
  freshDatabase,
  restartBackend,
} from "../../node_modules/@antelopejs/dms/e2e/backend.mjs";

/**
 * @typedef {import("@antelopejs/dms/e2e/run").RunState} RunState
 * @typedef {{ name: string, pass: boolean, detail: string }} Check
 * @typedef {{ id: string, title: string, knownFailures?: Record<string, string>, run: (ctx: IntegrationContext) => Promise<void> }} Journey
 */

const TEST_TIMEOUT_MS = 10 * 60_000;
const UNIQUE_BYTES = 3;
const PASSWORD_BYTES = 12;

/** @type {Awaited<ReturnType<typeof startRun>> | undefined} */
let started;
let count = 0;
before(async () => {
  started = await startRun();
});
after(() => started?.stop());

/** A critical step failed: the journey ends there. */
class Abort extends Error {}

/**
 * @param {string} text A label
 * @returns {string} The label as a folder name
 */
function slug(text) {
  return (
    text
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "step"
  );
}

/** What a journey drives a run through, on the run's database of the moment: the API as an account, backend restarts, and checks recorded per step. */
export class IntegrationContext {
  /**
   * @param {RunState} state The run, moved onto the journey's fresh database
   * @param {string} folder Where the journey's evidence goes
   */
  constructor(state, folder) {
    this.state = state;
    this.folder = folder;
    this.index = 0;
    /** @type {{ step: string, checks: Check[] }[]} */
    this.steps = [];
  }

  /**
   * @param {string} label What the step does
   * @returns {string} A new numbered step folder
   */
  step(label) {
    this.index += 1;
    const folder = join(
      this.folder,
      `${String(this.index).padStart(2, "0")}-${slug(label)}`,
    );
    mkdirSync(folder, { recursive: true });
    return folder;
  }

  /**
   * @param {string} folder The step folder
   * @param {Check[]} checks The step's checks
   * @param {{ critical?: boolean }} [options] Whether a failure ends the journey
   * @returns {boolean} Whether every check passed
   */
  record(folder, checks, options = {}) {
    this.steps.push({ step: folder.slice(this.folder.length + 1), checks });
    writeFileSync(
      join(folder, "checks.json"),
      `${JSON.stringify(checks, null, 2)}\n`,
    );
    const passed = checks.every((check) => check.pass);
    if (!passed && options.critical) throw new Abort(folder);
    return passed;
  }

  /**
   * @param {string} label What the step verifies
   * @param {(Check | Promise<Check>)[]} checks The checks
   * @param {{ critical?: boolean }} [options] Whether a failure ends the journey
   * @returns {Promise<boolean>} Whether every check passed
   */
  async verify(label, checks, options = {}) {
    return this.record(
      this.step(label),
      await Promise.all(checks.map((check) => Promise.resolve(check))),
      options,
    );
  }

  /**
   * @param {string} label What the call does
   * @param {{ method: string, path: string, body?: unknown, as?: string }} request What to send, as `admin` by default
   */
  api(label, request) {
    return apiRequest(this.state, {
      ...request,
      as: request.as ?? "admin",
      folder: () => this.step(`api ${label}`),
    });
  }

  /**
   * @param {string} name The account name
   * @param {RunState["accounts"][string]} credentials Its credentials
   */
  addAccount(name, credentials) {
    this.state.accounts = { ...this.state.accounts, [name]: credentials };
  }

  /** @param {string} prefix @returns {string} A string unique to this journey */
  unique(prefix) {
    return `${prefix} ${randomBytes(UNIQUE_BYTES).toString("hex")}`;
  }

  /** @returns {string} A password the DMS policy accepts */
  password() {
    return `Vr1!${randomBytes(PASSWORD_BYTES).toString("base64url").replace(/[-_]/g, "x")}`;
  }

  /** Restarts the backend on the same database with `state.extraEnv`. */
  async restartBackend() {
    await restartBackend(this.state);
  }

  /** @returns {never} */
  tab() {
    throw new Error(
      "an integration test opens no browser tab: this journey belongs in the Playwright suite",
    );
  }
}

/**
 * The checks that fail the test: failing ones the journey does not know
 * about, and known failures that now pass.
 *
 * @param {IntegrationContext} ctx The driven journey
 * @param {Record<string, string>} known The journey's known failures and their findings
 * @returns {string[]} One line per failed check
 */
function verdict(ctx, known) {
  return ctx.steps.flatMap(({ step, checks }) =>
    checks.flatMap((check) => {
      if (!Object.hasOwn(known, check.name))
        return check.pass ? [] : [`${step}: ${check.name}: ${check.detail}`];
      return check.pass
        ? [
            `${step}: ${check.name} passes: remove it from knownFailures (${known[check.name]})`,
          ]
        : [];
    }),
  );
}

/**
 * Registers each journey as a `node:test` test of the calling file. The
 * process starts one run with `startRun()`, which every file of a
 * `--test-isolation=none` run shares; each test moves it onto a fresh
 * database with a backend of its own and an onboarded administrator, drives
 * the journey through the API, then fails on any failing check that is not a
 * known failure. Evidence goes to `<run>/evidence/<feature>/<journey>/`.
 *
 * @param {string} feature The feature the journeys belong to
 * @param {Journey[]} journeys The journeys
 */
export function journeyTests(feature, journeys) {
  for (const journey of journeys) {
    void test(journey.id, { timeout: TEST_TIMEOUT_MS }, async (t) => {
      assert.ok(started, "the run started");
      const { run } = started;
      count += 1;
      await freshDatabase(run, `j${String(count).padStart(3, "0")}`);
      const onboarded = await onboard(run, {});
      assert.equal(
        onboarded.login?.status,
        200,
        `the administrator is onboarded and signed in (register ${onboarded.register.status})`,
      );
      const ctx = new IntegrationContext(
        run,
        join(run.evidence, feature, journey.id),
      );
      const known = journey.knownFailures ?? {};
      try {
        await journey.run(ctx);
      } catch (failure) {
        if (!(failure instanceof Abort)) throw failure;
      }
      for (const [name, finding] of Object.entries(known))
        t.diagnostic(`known failure: ${name}: ${finding}`);
      const failed = verdict(ctx, known);
      assert.deepEqual(failed, [], `${journey.title}\nevidence: ${ctx.folder}`);
    });
  }
}
