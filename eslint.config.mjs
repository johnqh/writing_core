import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import globals from 'globals';

const tsRules = {
  ...typescript.configs.recommended.rules,
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-non-null-assertion': 'warn',
  '@typescript-eslint/no-empty-object-type': 'off',
  // TypeScript checks redeclaration and undefined names; the core rules misfire on TS.
  'no-redeclare': 'off',
  'no-undef': 'off',
};

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: typescriptParser, ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.es2021 } },
    plugins: { '@typescript-eslint': typescript },
    rules: tsRules,
  },
  {
    files: ['src/**/*.test.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['scripts/**/*.ts'],
    languageOptions: { parser: typescriptParser, ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    plugins: { '@typescript-eslint': typescript },
    rules: { ...tsRules, '@typescript-eslint/no-non-null-assertion': 'off' },
  },
];
