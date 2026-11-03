import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

/**
 * Packages the node tests load by relative path from `frontend-vue/node_modules`.
 * The Vue layer installs them; this package does not list them.
 */
const FRONTEND_PACKAGES = [
  "vue",
  "vite",
  "eslint",
  "vue-eslint-parser",
  "typescript-eslint",
  "ofetch",
];

/**
 * Packages the verification skill's runs load: `dms-control` reaches the
 * MongoDB driver through `mongodb-memory-server-core`.
 */
const VERIFICATION_PACKAGES = ["mongodb-memory-server-core"];

export default antelopeKnipConfig({
  ignoreDependencies: [...FRONTEND_PACKAGES, ...VERIFICATION_PACKAGES],
});
