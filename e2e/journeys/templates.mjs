import { byRunner, guarded } from "../guard.mjs";
import { templatesJourneys1 } from "./parts/templates-journeys-1.mjs";
import { templatesJourneys2 } from "./parts/templates-journeys-2.mjs";
import { templatesJourneys3 } from "./parts/templates-journeys-3.mjs";
import { templatesJourneys4 } from "./parts/templates-journeys-4.mjs";
import { templatesJourneys5 } from "./parts/templates-journeys-5.mjs";

const all = guarded([...templatesJourneys1, ...templatesJourneys2, ...templatesJourneys3, ...templatesJourneys4, ...templatesJourneys5]);

export const { journeys, integration } = byRunner(all);
