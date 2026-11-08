// @ts-check
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/', '**/coverage/', '**/node_modules/']),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Governance §15: "no `any` without a comment". `any` is an error, and any
  // eslint-disable directive must carry a `-- reason` description.
  eslintComments.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@eslint-community/eslint-comments/require-description': 'error',
      '@eslint-community/eslint-comments/no-unused-disable': 'error',
    },
  },

  // Node: server, shared and root config files.
  {
    files: ['apps/server/**', 'packages/**', '*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  // Browser: React web client.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },

  // shadcn/ui components are vendored from the registry and export variants (e.g.
  // buttonVariants) next to components, which react-refresh flags.
  {
    files: ['apps/web/src/components/ui/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  // Must stay last: turns off rules that would fight Prettier.
  prettier,
);
