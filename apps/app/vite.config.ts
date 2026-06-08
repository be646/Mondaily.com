import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: ['app.mondaily.com', 'mondaily-app.onrender.com'],
    port: 10000,
    host: true
  },
  build: {
    outDir: 'dist'
  }
})
