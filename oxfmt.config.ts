import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/** The journeys, their helpers and the playground keep their own layout. */
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
