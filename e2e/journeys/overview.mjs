import { byRunner, guarded } from "../guard.mjs";
import { attentionJourneys } from "./parts/overview-attention.mjs";
import { bannerJourneys } from "./parts/overview-banner.mjs";
import { figureJourneys } from "./parts/overview-figures.mjs";
import { listJourneys } from "./parts/overview-lists.mjs";
import { periodJourneys } from "./parts/overview-period.mjs";
import { routeJourneys } from "./parts/overview-routes.mjs";
import { recipeJourneys } from "./parts/overview-recipes.mjs";
import { equivalenceJourneys } from "./parts/stats-equivalence.mjs";

const all = guarded([...recipeJourneys, ...bannerJourneys, ...figureJourneys, ...periodJourneys, ...attentionJourneys, ...listJourneys, ...routeJourneys, ...equivalenceJourneys]);

export const { journeys, integration } = byRunner(all);
