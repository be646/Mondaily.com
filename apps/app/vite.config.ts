import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  // Match the tsconfig "@/*" -> "src/*" alias so Vite/Rollup resolves it.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  preview: {
    allowedHosts: ['app.mondaily.com', 'mondaily-app.onrender.com'],
    port: 10000,
    host: true
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-clerk': ['@clerk/react'],
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-popover', '@radix-ui/react-select', '@radix-ui/react-tabs', '@radix-ui/react-tooltip', 'lucide-react'],
          'vendor-editor': ['@tiptap/react', '@tiptap/starter-kit'],
          'vendor-charts': ['recharts'],
          'vendor-motion': ['framer-motion'],
        }
      }
    }
  }
})
