import { byRunner, guarded } from "../guard.mjs";
import { catalogJourneys } from "./parts/library-catalog.mjs";
import { useJourneys } from "./parts/library-use.mjs";

const all = guarded([...catalogJourneys, ...useJourneys]);

export const { journeys, integration } = byRunner(all);
