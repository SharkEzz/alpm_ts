import { defineConfig } from 'oxfmt';

export default defineConfig({
  arrowParens: 'always',
  bracketSameLine: true,
  bracketSpacing: true,
  endOfLine: 'lf',
  ignorePatterns: ['node_modules', 'scripts/alpm-coverage-baseline.json'],
  objectWrap: 'preserve',
  printWidth: 110,
  quoteProps: 'as-needed',
  semi: true,
  singleQuote: true,
  sortImports: false,
  sortPackageJson: true,
  sortTailwindcss: false,
  tabWidth: 2,
  trailingComma: 'all',
  useTabs: false,
});
