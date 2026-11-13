import eslint from "@eslint/js";
import ts from "typescript-eslint";
import vue from "eslint-plugin-vue";
import dmsGlobals from "@antelopejs/dms/eslint-globals";
import dmsFrontendGlobals from "@antelopejs/dms-frontend/eslint-globals";
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
      globals: {
        ...globals.browser,
        ...globals.node,
        ...dmsFrontendGlobals,
        ...dmsGlobals,
      },
    },
    rules: {
      "no-unused-vars": "off",
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
