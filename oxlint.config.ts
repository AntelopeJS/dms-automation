import {
  ANTELOPE_IGNORE_PATTERNS,
  antelopePreset,
} from "@antelopejs/tooling-configs/oxc/lint";
import { defineConfig } from "oxlint";

/** The Vue layer keeps its own ESLint config, from either the root or a package. */
export default defineConfig({
  extends: [antelopePreset({ importSorting: false })],
  ignorePatterns: [...ANTELOPE_IGNORE_PATTERNS, "**/frontend-vue/**"],
  options: {
    typeAware: true,
  },
});
