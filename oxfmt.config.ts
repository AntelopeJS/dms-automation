import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/** The journeys, their helpers and the playground keep the layout they had in the verify skill. */
export default antelopeFmtPreset({
  ignorePatterns: [
    "**/nuxt-layer/**",
    "**/*.md",
    "**/*.vue",
    "e2e/journeys/**",
    "e2e/*.mjs",
    "e2e/playground/**",
  ],
});
