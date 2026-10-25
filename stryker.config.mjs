/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  // pnpm's isolated node_modules hides the runner from Stryker's default plugin glob
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'html', 'json'],
  thresholds: { high: 80, low: 70, break: null },
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
};
