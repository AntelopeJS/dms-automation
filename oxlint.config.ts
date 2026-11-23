import {
  ANTELOPE_IGNORE_PATTERNS,
  antelopePreset,
} from "@antelopejs/tooling-configs/oxc/lint";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [antelopePreset({ importSorting: false })],
  ignorePatterns: ANTELOPE_IGNORE_PATTERNS,
  options: {
    typeAware: true,
  },
});
