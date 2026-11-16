import { guarded } from "../guard.mjs";
import { docsJourneys } from "./parts/package-docs.mjs";
import { manifestJourneys } from "./parts/package-manifest.mjs";
import { skillJourneys } from "./parts/package-skills.mjs";
import { surfaceJourneys } from "./parts/package-surface.mjs";

export const journeys = guarded([...manifestJourneys, ...skillJourneys, ...surfaceJourneys, ...docsJourneys]);
