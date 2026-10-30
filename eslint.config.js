'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');

const sharedRules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': 'error',
  'no-console': 'off'
};

module.exports = [
  // .claude/ holds third-party agent skills (pstack), not app code.
  { ignores: ['node_modules/**', 'dist/**', 'build/**', '.devdata/**', 'coverage/**', '.claude/**'] },
  js.configs.recommended,
  {
    // Main process, preload, scripts, tests (CommonJS on Node/Electron)
    files: ['src/main/**/*.js', 'src/preload.js', 'scripts/electron.js', 'test/**/*.js', '*.config.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: sharedRules
  },
  {
    files: ['vite.config.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: sharedRules
  },
  {
    // Executed inside the renderer by the smoke test
    files: ['scripts/smoke-scenario.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } },
    rules: sharedRules
  },
  {
    // UMD modules used by both processes
    files: ['src/shared/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.node, ...globals.browser } },
    rules: sharedRules
  },
  {
    // React renderer (bundled by Vite, runs in a sandboxed browser context)
    files: ['src/renderer/src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '18.3' } },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser }
    },
    rules: {
      ...sharedRules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      // Markup is always built with JSX (escaped by React); never inject HTML.
      'react/no-danger': 'error',
      'no-restricted-properties': ['error', { property: 'innerHTML', message: 'Render with JSX instead' }],
      'no-restricted-globals': ['error', { name: 'alert', message: 'Use toast()' }, { name: 'confirm', message: 'Use useConfirm()' }, { name: 'prompt', message: 'Use a dialog' }]
    }
  }
];
