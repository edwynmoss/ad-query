import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // Listen on all interfaces so a containerized browser (host.docker.internal)
  // can reach the dev server. Harmless for local Wails dev.
  server: { host: true, port: 5290, strictPort: true, allowedHosts: true },
})
