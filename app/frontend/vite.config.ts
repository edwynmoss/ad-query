import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Listen on all interfaces so a containerized browser (host.docker.internal)
  // can reach the dev server. Harmless for local Wails dev.
  server: { host: true, port: 5290, strictPort: true, allowedHosts: true },
})
