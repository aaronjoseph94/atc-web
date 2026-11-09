import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { apiDevPlugin } from './scripts/vite-api-plugin.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), apiDevPlugin()],
  build: {
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
