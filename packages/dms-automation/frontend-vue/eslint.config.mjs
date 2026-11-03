import eslint from "@eslint/js";
import ts from "typescript-eslint";
import vue from "eslint-plugin-vue";
import globals from "globals";
import automation from "./eslint-rules/index.mjs";

export default ts.config(
  { ignores: ["dist/**", "node_modules/**"] },
  eslint.configs.recommended,
  ...vue.configs["flat/essential"],
  {
    files: ["tests/**/*.cjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.{ts,vue}"],
    languageOptions: {
      parserOptions: { parser: ts.parser },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-redeclare": "off",
      "vue/multi-word-component-names": "off",
    },
  },
  { files: ["**/*.ts"], languageOptions: { parser: ts.parser } },
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
