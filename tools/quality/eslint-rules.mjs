import js from '@eslint/js';
import globals from 'globals';

const nodeSources = [
  'cli', 'client-assets', 'color-preferences', 'config', 'editor-session',
  'engine', 'font-files', 'form', 'images', 'live', 'native-clipboard',
  'native-mcp', 'render-fonts', 'replacement-image', 'server', 'system-fonts',
  'template',
].map(name => `src/${name}.mjs`);
const browserDesktop = ['desktop/standalone-pwh/app.js', 'desktop/standalone-pwh/workspace.js'];

export default [
  {
    ignores: [
      '**/node_modules/**', 'client/**', 'desktop/standalone-pwh/client/**',
      'vendor/**', 'releases/**', 'src/inline-host.js',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {ecmaVersion: 2025},
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': ['error', {allowEmptyCatch: true}],
      // HWP and path validation deliberately reject C0 control characters.
      'no-control-regex': 'off',
      // Public failures deliberately translate and sanitize internal errors.
      'preserve-caught-error': 'off',
      // Start with correctness rules. Removing unused code is a separate edit.
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
    },
  },
  {
    files: ['src/**/*.{js,mjs}', ...browserDesktop],
    ignores: nodeSources,
    languageOptions: {globals: globals.browser},
  },
  {
    files: [...nodeSources, 'scripts/**/*.{js,mjs}', 'tools/quality/**/*.{js,mjs}', 'desktop/**/*.{js,mjs}', 'eslint.config.mjs'],
    ignores: browserDesktop,
    languageOptions: {globals: globals.node},
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {sourceType: 'commonjs', globals: globals.node},
  },
  {
    // Playwright evaluate callbacks execute in a browser inside Node tests.
    files: ['tests/**/*.mjs', 'desktop/**/*.check.mjs'],
    languageOptions: {globals: {...globals.node, ...globals.browser}},
  },
];
