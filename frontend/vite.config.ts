import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' keeps the build portable: GitHub Pages, Tauri and Capacitor all work.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173 },
})
