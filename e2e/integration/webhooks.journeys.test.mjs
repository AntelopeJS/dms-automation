import { integration } from "../journeys/webhooks.mjs";
import { journeyTests } from "./journey-test.mjs";

journeyTests("webhooks", integration);
