import { guarded } from "../guard.mjs";
import { catalogJourneys } from "./parts/library-catalog.mjs";
import { useJourneys } from "./parts/library-use.mjs";

export const journeys = guarded([...catalogJourneys, ...useJourneys]);
