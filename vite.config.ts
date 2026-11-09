import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { apiDevPlugin } from './scripts/vite-api-plugin.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), apiDevPlugin()],
  build: {
    // MapLibre is ~700 KB minified; it lands in its own lazy chunk (see
    // MapView's dynamic import) so the warning threshold is raised for it.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    // Pure modules run in node; component tests opt into jsdom via a
    // `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.test.{ts,tsx}'],
    },
  },
})
