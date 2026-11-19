import { guarded } from "../guard.mjs";
import { runJourneys } from "./parts/package-run.mjs";

export const journeys = guarded(runJourneys);
