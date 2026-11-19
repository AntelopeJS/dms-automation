import { byRunner, guarded } from "../guard.mjs";
import { runJourneys } from "./parts/package-run.mjs";

const all = guarded(runJourneys);

export const { journeys, integration } = byRunner(all);
