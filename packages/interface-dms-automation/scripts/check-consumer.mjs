// Consumers compile against the packed tarball, not the sources, and they are
// spread across the three resolution modes: most AntelopeJS modules are still
// on `moduleResolution: node`, which ignores `exports` and reads
// `typesVersions`, while newer ones use `node16` or `bundler`, which ignore
// `typesVersions` and read `exports`. The two maps have to agree, and the
// emitted declarations have to typecheck on their own, so `skipLibCheck` is
// off here even though consumers usually keep it on.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);

const RESOLUTIONS = [
  ["node", "commonjs"],
  ["Node16", "Node16"],
  ["bundler", "preserve"],
];

const CONSUMER_SOURCE = `
import {
  InvokeProcedure,
  ListActionTypes,
  ListDataNodeTypes,
  ListTriggerTypes,
  RegisterActionType,
  RegisterDataNodeType,
  RegisterTriggerType,
  UnregisterActionType,
  UnregisterDataNodeType,
  UnregisterTriggerType,
  internal,
  type ActionType,
  type DataNodeType,
  type ExecutionCtx,
  type JsonSchema,
  type LogLevel,
  type TriggerType,
} from "@antelopejs/interface-dms-automation";
// A module that re-exports the contract emits declarations pointing at the
// resolved \`dist/\` form, and its own consumers have to resolve that.
import type { TriggerType as TriggerTypeViaDist } from "@antelopejs/interface-dms-automation/dist/index";

const surface = [
  InvokeProcedure,
  ListActionTypes,
  ListDataNodeTypes,
  ListTriggerTypes,
  UnregisterActionType,
  UnregisterDataNodeType,
  UnregisterTriggerType,
  internal.RegisterTriggerType,
];

const schema: JsonSchema = { type: "object" };

const trigger: TriggerType = {
  id: "module.tick",
  name: "Tick",
  description: "Fires on a schedule.",
  icon: "i-lucide-clock",
  configSchema: schema,
  outputSchema: schema,
  // Required field: a trigger provider that forgets it must not compile.
  cluster: "singleton",
  activate: async (_config, emit) => {
    emit({ at: Date.now() });
    return undefined;
  },
  deactivate: async () => {},
};

const action: ActionType = {
  id: "module.length",
  name: "Length",
  description: "Measures a payload.",
  icon: "i-lucide-ruler",
  inputSchema: schema,
  outputSchema: schema,
  execute: async (input, ctx: ExecutionCtx) => {
    const level: LogLevel = "info";
    ctx.log(level, "measuring", input);
    return input;
  },
};

const dataNode: DataNodeType = {
  id: "module.upper",
  category: "text",
  name: "Upper",
  description: "Upper-cases a string.",
  icon: "i-lucide-type",
  inputSchema: schema,
  outputSchema: schema,
  evaluate: (input) => input,
};

RegisterTriggerType(trigger);
RegisterActionType(action);
RegisterDataNodeType(dataNode);

// The generic parameters are part of the contract too.
const typedTrigger: TriggerType<{ cron: string }, { at: number }> = {
  ...trigger,
  activate: async (config, emit) => {
    emit({ at: config.cron.length });
    return undefined;
  },
};

const viaDist = undefined as TriggerTypeViaDist | undefined;

// @ts-expect-error \`cluster\` is required on every trigger type.
const incomplete: TriggerType = {
  id: "module.broken",
  name: "Broken",
  description: "Declares no cluster semantics.",
  icon: "i-lucide-x",
  configSchema: schema,
  outputSchema: schema,
  activate: async () => undefined,
  deactivate: async () => {},
};

void [surface, typedTrigger, viaDist, incomplete];
`;

function runPnpm(args, cwd) {
  return execFileAsync("pnpm", args, {
    cwd,
    env: { ...process.env, npm_config_ignore_scripts: "true" },
  });
}

async function main() {
  let temporaryRoot;
  try {
    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "interface-dms-automation-consumer-"),
    );
    const archivePath = path.join(
      temporaryRoot,
      "interface-dms-automation.tgz",
    );
    const consumerRoot = path.join(temporaryRoot, "consumer");
    fs.mkdirSync(consumerRoot);
    await runPnpm(["pack", "--out", archivePath, "--silent"], packageRoot);
    fs.writeFileSync(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "interface-dms-automation-consumer",
          version: "1.0.0",
          private: true,
          packageManager: manifest.packageManager,
          dependencies: {
            [manifest.name]: `file:${archivePath}`,
            ...manifest.peerDependencies,
          },
          devDependencies: {
            "@types/node": manifest.devDependencies["@types/node"],
            typescript: manifest.devDependencies.typescript,
          },
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(path.join(consumerRoot, "consumer.ts"), CONSUMER_SOURCE);
    await runPnpm(["install", "--prefer-offline"], consumerRoot);

    // `files` drifting, or a pack that ran before the build, ships a tarball
    // with no `dist`. Every resolution then fails at once with a message about
    // the specifier rather than about the package that is actually empty.
    const installedRoot = path.join(
      consumerRoot,
      "node_modules",
      ...manifest.name.split("/"),
    );
    if (!fs.existsSync(path.join(installedRoot, "dist", "index.js"))) {
      throw new Error(
        `The packed tarball carries no dist/index.js. Run \`pnpm run build\` first and check the "files" field of ${manifest.name}.`,
      );
    }

    for (const [moduleResolution, module] of RESOLUTIONS) {
      const configName = `tsconfig.${moduleResolution.toLowerCase()}.json`;
      fs.writeFileSync(
        path.join(consumerRoot, configName),
        `${JSON.stringify(
          {
            compilerOptions: {
              moduleResolution,
              module,
              target: "ES2022",
              strict: true,
              noEmit: true,
              skipLibCheck: false,
            },
            files: ["consumer.ts"],
          },
          null,
          2,
        )}\n`,
      );
      try {
        await runPnpm(["exec", "tsc", "--project", configName], consumerRoot);
      } catch (error) {
        // tsc reports on stdout, and execFile's own message keeps only the
        // command line: without this the failure reads as "exit code 2".
        throw new Error(
          `A consumer on \`moduleResolution: ${moduleResolution}\` does not compile against ${manifest.name}:\n${(error.stdout ?? "").trim() || error.message}`,
          { cause: error },
        );
      }
      console.log(`${moduleResolution} resolves the public surface.`);
    }
  } finally {
    if (temporaryRoot !== undefined) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

await main();
