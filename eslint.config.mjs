// @ts-check

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    // Only an object with nothing but `ignores` (and `name`) is a global
    // ignore. Adding any other key turns it into a per-object exclusion.
    name: 'kit/ignore-build-output',
    ignores: ['dist/**', 'coverage/**'],
  },
  {
    name: 'kit/linter-controls',
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    name: 'kit/typescript',
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    name: 'kit/async-test-doubles',
    files: ['src/**/*.test.ts', 'test/**/*.ts'],
    rules: {
      // In-memory doubles implement async interfaces on purpose.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Every test in this repo drives a real MCP Client/Server pair and reads
    // back a CallToolResult, whose `content` is SDK-typed as loosely-shaped
    // JSON-RPC payload blocks. parseJson() in server.test.ts (and its local
    // equivalent in workerTimeout.test.ts) parses the second content block's
    // text as the wrapped kit's JSON result. Each kit already fully types
    // and tests its own return shape in its own suite; re-declaring ~14
    // different result interfaces a second time here, purely to satisfy the
    // type-checker on values these tests already assert the real shape of
    // field-by-field, would be duplication with no added safety -- the
    // assertions themselves (toBe/toEqual on specific fields) are what
    // verifies correctness, not the static type of the intermediate value.
    name: 'kit/dynamic-json-rpc-test-payloads',
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    name: 'kit/node-esm-scripts',
    files: ['scripts/**/*.mjs', 'examples/**/*.mjs', 'eslint.config.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.nodeBuiltin,
    },
  },
  {
    // consumer-probe.mts imports the package by name, which only resolves in
    // the temporary consumer project. verify-package.mjs type-checks it there.
    name: 'kit/type-probe-script',
    files: ['scripts/**/*.mts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.nodeBuiltin,
    },
  },
);
