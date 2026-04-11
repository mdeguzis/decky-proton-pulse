// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporter: 'verbose',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'cobertura'],
      reportsDirectory: 'coverage/ts',
      include: ['src/lib/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.ts',
        'src/lib/compatTools.ts',
        'src/lib/issueReport.ts',
        'src/lib/prefetch.ts',
        'src/lib/screenshotAutomation.ts',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
      },
    },
  },
});
