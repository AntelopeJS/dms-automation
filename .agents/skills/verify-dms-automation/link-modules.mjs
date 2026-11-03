import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const moduleModules = join(root, "packages/dms-automation/node_modules");
const target = join(here, "playground/node_modules");

if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false })) rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, "@antelopejs"), { recursive: true });
for (const entry of readdirSync(moduleModules)) {
  if (entry === ".bin" || entry === "@antelopejs" || entry.startsWith(".")) continue;
  symlinkSync(join(moduleModules, entry), join(target, entry));
}
for (const entry of readdirSync(join(moduleModules, "@antelopejs"))) {
  symlinkSync(join(moduleModules, "@antelopejs", entry), join(target, "@antelopejs", entry));
}
