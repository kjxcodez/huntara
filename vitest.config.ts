import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/api/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.ts',
      'apps/marketing/**/*.test.ts'
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/.next/**',
      '**/*.js',
      '**/*.d.ts',
      // Native Electron SQLite integration tests executed via test:integration runner
      'apps/desktop/src/main/services/audiences.test.ts',
      'apps/desktop/src/main/services/campaign-lifecycle-safety-sqlite.test.ts',
      'apps/desktop/src/main/services/campaign.test.ts',
      'apps/desktop/src/main/services/campaign-analytics.test.ts',
      'apps/desktop/src/main/services/email-quality-intelligence.test.ts',
      'apps/desktop/src/main/services/fresh-database.test.ts',
      'apps/desktop/src/main/services/fresh-database-all-queries.test.ts',
      'apps/desktop/src/main/services/operations-cache.test.ts',
      'apps/desktop/src/main/services/outreach-lineage.test.ts',
      'apps/desktop/src/main/services/inbound-suppression.test.ts',
      'apps/desktop/src/main/services/operational-reliability.test.ts',
      'apps/desktop/src/main/services/production-qualification-e2e.test.ts',
      'apps/desktop/src/main/services/crash-matrix-qualification.test.ts',
      'apps/desktop/src/main/services/post-release-stabilization.test.ts',
      'apps/desktop/src/main/services/release-qualification.test.ts',
      'apps/desktop/src/main/services/scheduler-execution-hardening.test.ts',
      'apps/desktop/src/main/services/adversarial-cross-race-qualification.test.ts'
    ],
    alias: {
      '@': path.resolve(__dirname, 'apps/desktop/src'),
      '@huntara/schema': path.resolve(__dirname, 'packages/schema/src/index.ts'),
      '@huntara/sdk': path.resolve(__dirname, 'packages/sdk/src/index.ts'),
      '@huntara/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@huntara/logger': path.resolve(__dirname, 'packages/logger/src/index.ts'),
      '@huntara/auth': path.resolve(__dirname, 'packages/auth/src/index.ts'),
      '@huntara/agent-core': path.resolve(__dirname, 'packages/agent-core/src/index.ts'),
      '@huntara/agent-runtime': path.resolve(__dirname, 'packages/agent-runtime/src/index.ts'),
      '@huntara/workflow-engine': path.resolve(__dirname, 'packages/workflow-engine/src/index.ts'),
      '@huntara/ai': path.resolve(__dirname, 'packages/ai/src/index.ts'),
      '@leadforge/schema': path.resolve(__dirname, 'packages/schema/src/index.ts'),
      '@leadforge/sdk': path.resolve(__dirname, 'packages/sdk/src/index.ts'),
      '@leadforge/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@leadforge/logger': path.resolve(__dirname, 'packages/logger/src/index.ts'),
      '@leadforge/auth': path.resolve(__dirname, 'packages/auth/src/index.ts')
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/out/**',
        '**/*.test.ts',
        '**/*.spec.ts'
      ]
    }
  }
});
