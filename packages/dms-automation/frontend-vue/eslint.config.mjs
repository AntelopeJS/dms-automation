import { antelopeNuxtConfig } from "@antelopejs/tooling-configs/eslint";
import automation from "./eslint-rules/index.mjs";

export default antelopeNuxtConfig({
  typeAware: { tsconfigRootDir: import.meta.dirname },
})
  .prepend({ ignores: [".dms-types/**"] })
  .append(
    {
      files: ["app/**/*.{ts,vue}"],
      plugins: { automation },
      rules: { "automation/confirm-from-row-tokens": "error" },
    },
    {
      files: ["app/**/*.vue"],
      plugins: { automation },
      rules: { "automation/no-comment-before-else": "error" },
    },
  );
