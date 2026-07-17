import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vitest/config'

const coverageDir = path.resolve(__dirname, 'coverage')

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/helpers/setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
      'tests/integration/**/*.test.tsx',
      'tests/smoke/**/*.test.ts',
      'tests/smoke/**/*.test.tsx',
      'tests/security/**/*.test.ts',
      'tests/security/**/*.test.tsx',
    ],
    fileParallelism: false,
    testTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: coverageDir,
      clean: true,
      cleanOnRerun: true,
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      // Gate: core logic + auth/public surfaces. App route shells are covered by smoke + E2E.
      include: [
        'src/lib/**/*.{ts,tsx}',
        'src/stores/**/*.ts',
        'src/pages/auth/**/*.{ts,tsx}',
        'src/pages/public/**/*.{ts,tsx}',
      ],
      exclude: [
        'tests/**',
        'src/vite-env.d.ts',
        'src/lib/types.ts',
        'src/routes/lazyPages.ts',
        'src/main.tsx',
        'src/lib/build/**',
        'src/lib/msal.ts',
        'src/lib/clarity.ts',
      ],
      thresholds: {
        lines: 94,
        statements: 94,
        functions: 93,
        branches: 86,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests/helpers'),
    },
  },
})
