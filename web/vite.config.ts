import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { apiPlugin } from './server/api.ts'

// `--mode static` builds the published, read-only site: no API (data comes from
// scripts/export-static.ts), served under BASE_PATH (e.g. /ymmv/ on GitHub Pages).
export default defineConfig(({ mode }) => ({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), ...(mode === 'static' ? [] : [apiPlugin()])],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  // One ~1.2 MB bundle (mostly ECharts) is fine.
  build: { chunkSizeWarningLimit: 1500 },
}))
