import { guarded } from "../guard.mjs";
import { clusterJourneys } from "./parts/cluster-journeys.mjs";

export const journeys = guarded([...clusterJourneys]);
