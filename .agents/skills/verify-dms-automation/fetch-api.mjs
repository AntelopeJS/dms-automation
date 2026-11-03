import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "api-module");
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "verify-dms-automation-api-pack-"));
const VERSION = "1.6.0";
const OLD = "handler.proto.constructor";
const NEW = "handler.controller ?? handler.proto.constructor";

/**
 * The published @antelopejs/api still reads `handler.proto.constructor`, while the module registers its webhook
 * routes with `RouteHandler.controller` (the api module's campaign/integration reads only that). This unpacks the
 * published package into the playground and lets it read `controller` first, so webhook calls reach the module.
 */
if (existsSync(target)) rmSync(target, { recursive: true, force: true });
execFileSync("npm", ["pack", `@antelopejs/api@${VERSION}`, "--silent", "--pack-destination", work], { stdio: "ignore" });
execFileSync("tar", ["-xzf", join(work, `antelopejs-api-${VERSION}.tgz`), "-C", work]);
cpSync(join(work, "package"), target, { recursive: true });
const file = join(target, "dist/implementations/api/index.js");
const source = readFileSync(file, "utf8");
if (!source.includes(OLD)) throw new Error(`@antelopejs/api ${VERSION} no longer reads ${OLD}`);
writeFileSync(file, source.replace(OLD, NEW));
execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"], { cwd: target, stdio: "ignore" });
rmSync(work, { recursive: true, force: true });
