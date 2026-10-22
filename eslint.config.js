// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['node_modules/**', '.wrangler/**', '.dry-run/**', 'dist/**'] },

  js.configs.recommended,

  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: { ...globals.worker },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // Explicit `any` is a decision, not an accident; flag it but do not fail.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Unused args are fine when they document a signature.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      // Promise-returning handlers are idiomatic with Hono middleware.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } }
      ],
      eqeqeq: ['error', 'smart']
    }
  },

  {
    // Browser ES modules and this config file: no type information available.
    files: ['public/**/*.js', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node }
    }
  },

  {
    files: ['tests/**/*.ts'],
    rules: {
      // Tests assert on deliberately loose fixtures.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off'
    }
  },

  // Keep last: switches off stylistic rules that would fight Prettier.
  prettier
);
