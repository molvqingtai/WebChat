import path from 'node:path'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // SVG imports are React components in the build, so tests must see the same thing.
  plugins: [react(), svgr({ include: '**/*.svg' })],
  resolve: {
    alias: {
      '#imports': path.resolve(import.meta.dirname, 'vitest.wxt-imports.ts'),
      '@': path.resolve(import.meta.dirname, 'src')
    }
  },
  test: {
    // CI runners are slower than a developer machine; the behaviours under test are real browser
    // and DOM interactions, so give them room instead of racing the 5 s default.
    testTimeout: 20000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'happy-dom',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'e2e/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts', 'src/**/*.browser.test.tsx']
        }
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts', 'src/**/*.browser.test.tsx'],
          // Every file drives the same browser and measures real geometry; running them in
          // parallel makes scroll behaviour race the CPU rather than the test's own frames.
          fileParallelism: false,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }]
          }
        }
      }
    ]
  }
})
