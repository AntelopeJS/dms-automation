import { integration } from "../journeys/redaction-and-retention.mjs";
import { journeyTests } from "./journey-test.mjs";

journeyTests("redaction-and-retention", integration);
