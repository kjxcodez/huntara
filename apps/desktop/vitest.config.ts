import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ['src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/.next/**',
      '**/*.js',
      '**/*.d.ts',
      // Native Electron SQLite integration tests executed via test:integration runner
      'src/main/services/audiences.test.ts',
      'src/main/services/campaign.test.ts',
      'src/main/services/campaign-analytics.test.ts',
      'src/main/services/campaign-lifecycle-safety-sqlite.test.ts',
      'src/main/services/crash-matrix-qualification.test.ts',
      'src/main/services/email-quality-intelligence.test.ts',
      'src/main/services/fresh-database.test.ts',
      'src/main/services/fresh-database-all-queries.test.ts',
      'src/main/services/inbound-suppression.test.ts',
      'src/main/services/operational-reliability.test.ts',
      'src/main/services/operations-cache.test.ts',
      'src/main/services/outreach-lineage.test.ts',
      'src/main/services/post-release-stabilization.test.ts',
      'src/main/services/production-qualification-e2e.test.ts',
      'src/main/services/release-qualification.test.ts',
      'src/main/services/scheduler-execution-hardening.test.ts',
      'src/main/services/adversarial-cross-race-qualification.test.ts'
    ],
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@huntara/schema': path.resolve(__dirname, '../../packages/schema/src/index.ts'),
      '@huntara/sdk': path.resolve(__dirname, '../../packages/sdk/src/index.ts'),
      '@huntara/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@huntara/logger': path.resolve(__dirname, '../../packages/logger/src/index.ts'),
      '@huntara/auth': path.resolve(__dirname, '../../packages/auth/src/index.ts')
    }
  }
});
