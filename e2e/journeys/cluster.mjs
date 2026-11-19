import { byRunner, guarded } from "../guard.mjs";
import { clusterJourneys } from "./parts/cluster-journeys.mjs";

const all = guarded([...clusterJourneys]);

export const { journeys, integration } = byRunner(all);
