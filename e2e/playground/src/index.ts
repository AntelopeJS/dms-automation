import { readFileSync } from "node:fs";
import {
  DeclareProcedure,
  type ProcedureDeclaration,
} from "@antelopejs/interface-dms-automation";
import { z } from "zod";
import { startSink } from "./sink";
import { registerAll } from "./types";
import { ledger } from "./ledger";
import "./fixture";

/**
 * Registers the fixture's node types, starts the HTTP sink the HTTP request
 * action calls, and ships the procedures `VERIFY_AUTO_DECLARE` names, a JSON
 * file holding an array of declarations, from `start()` as the docs tell a
 * module to.
 */
export function construct(): void {
  registerAll();
  startSink();
}

export async function start(): Promise<void> {
  const file = process.env.VERIFY_AUTO_DECLARE;
  if (!file) return;
  const declarations = z.array(z.custom<ProcedureDeclaration>()).parse(JSON.parse(readFileSync(file, "utf8")));
  for (const declaration of declarations) {
    try {
      const result = await DeclareProcedure(declaration);
      ledger.push({ kind: "declared", id: declaration.id, status: result.status, enabled: result.enabled, issues: result.issues.length });
    } catch (error) {
      ledger.push({ kind: "declare-refused", id: declaration.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
}
