// @ts-check
/**
 * Flat ESLint config for the vibe-calculators monorepo.
 *
 * Layered rules:
 *   1. Base: every TS file in apps/** and packages/**
 *   2. Calc-engine and tax-engine: extra restrictions enforcing the
 *      cross-cutting "no floats for money" convention from CLAUDE.md.
 *      parseFloat / parseInt / Number-as-cast / +str coercion are banned.
 */

import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";
import globals from "globals";

const moneyMathRestrictedGlobals = [
  {
    name: "parseFloat",
    message:
      "Currency/interest math must use Money/Rate (decimal.js). parseFloat is banned in calc-engine and tax-engine.",
  },
  {
    name: "parseInt",
    message:
      "Currency/interest math must use Money/Rate (decimal.js). parseInt is banned in calc-engine and tax-engine.",
  },
];

const moneyMathRestrictedSyntax = [
  {
    selector: "CallExpression[callee.name='Number']",
    message:
      "Number() coercion is banned in calc-engine and tax-engine. Use Money/Rate from decimal.js.",
  },
  {
    selector: "UnaryExpression[operator='+'][argument.type!='Literal']",
    message:
      "Unary-plus coercion to Number is banned in calc-engine and tax-engine. Use Money/Rate from decimal.js.",
  },
];

export default [
  // 0. Ignore directories that are not source-of-truth code.
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/storybook-static/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/.vite/**",
      "**/drizzle/**",
    ],
  },

  // 1. Base rules for the whole repo.
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // TypeScript already enforces "did you import this name?" via its
      // own analysis; no-undef misfires on type-only references like
      // `JSX.Element`, `React.FC`, etc.
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },

  // 2. Browser globals for apps/web.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // 3. Money-math discipline for calc-engine and tax-engine.
  {
    files: ["packages/calc-engine/**/*.{ts,tsx}", "packages/tax-engine/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": ["error", ...moneyMathRestrictedGlobals],
      "no-restricted-syntax": ["error", ...moneyMathRestrictedSyntax],
    },
  },

  // 4. Tests get looser type rules so test code can exercise edge cases.
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.test-d.ts", "**/*.spec.ts", "**/*.spec.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-syntax": "off",
      "no-restricted-globals": "off",
    },
  },

  // 5. Last: turn off rules that conflict with prettier formatting.
  prettier,
];
