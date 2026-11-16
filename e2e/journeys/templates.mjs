import { guarded } from "../guard.mjs";
import { templatesJourneys1 } from "./parts/templates-journeys-1.mjs";
import { templatesJourneys2 } from "./parts/templates-journeys-2.mjs";
import { templatesJourneys3 } from "./parts/templates-journeys-3.mjs";
import { templatesJourneys4 } from "./parts/templates-journeys-4.mjs";

export const journeys = guarded([...templatesJourneys1, ...templatesJourneys2, ...templatesJourneys3, ...templatesJourneys4]);
