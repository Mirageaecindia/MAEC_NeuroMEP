import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'docs/**',
      'prompts/**',
      'NeuroMEP UI/**',
      'revit-addin/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  // Security lint rules (design doc Section 6 Maintainability, WBS 1.1.3).
  security.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // Flags every obj[key]; with TypeScript-typed keys this is almost always a false positive.
      // Untrusted input is validated with Zod at the API boundary instead.
      'security/detect-object-injection': 'off',
    },
  },
  {
    // Tests, smoke-test fixtures and the one-time CableSizer converter read trusted local files with fixed regexes.
    files: ['**/*.test.{ts,tsx}', 'packages/rulepacks/scripts/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-unsafe-regex': 'off',
      'security/detect-possible-timing-attacks': 'off',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Architecture rule: the calculation engine stays pure (no UI, server, database or I/O).
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-*', 'express', 'mongodb', 'node:*'],
              message: 'The engine must stay pure (CLAUDE.md).',
            },
            {
              group: ['@neuromep/web', '@neuromep/api'],
              message: 'The engine must not import the apps.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
