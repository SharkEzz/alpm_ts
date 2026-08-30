import { defineConfig } from 'oxlint';

export default defineConfig({
  plugins: ['oxc', 'node', 'typescript', 'promise'],
  categories: {
    correctness: 'error',
    perf: 'warn',
    suspicious: 'warn',
  },
  rules: {
    'no-await-in-loop': 'off',
  },
  env: {
    builtin: true,
    node: true,
  },
  options: {
    typeAware: true,
  },
  overrides: [
    {
      files: ['test/**/*.ts'],
      rules: {
        'typescript/no-floating-promises': 'off',
      },
    },
  ],
});
