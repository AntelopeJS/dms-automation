import { byRunner, guarded } from "../guard.mjs";
import { builderJourneys1 } from "./parts/builder-journeys-1.mjs";
import { builderJourneys2 } from "./parts/builder-journeys-2.mjs";
import { builderJourneys3 } from "./parts/builder-journeys-3.mjs";
import { builderJourneys4 } from "./parts/builder-journeys-4.mjs";
import { builderJourneys5 } from "./parts/builder-journeys-5.mjs";
import { builderJourneys6 } from "./parts/builder-journeys-6.mjs";
import { builderJourneys7 } from "./parts/builder-journeys-7.mjs";

const all = guarded([...builderJourneys1, ...builderJourneys2, ...builderJourneys3, ...builderJourneys4, ...builderJourneys5, ...builderJourneys6, ...builderJourneys7]);

export const { journeys, integration } = byRunner(all);
