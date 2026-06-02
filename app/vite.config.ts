import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
  server: {
    port: 5173,
    proxy: {
      '/data': 'http://localhost:8000',
      '/history': 'http://localhost:8000',
      '/insight': 'http://localhost:8000',
      '/control': 'http://localhost:8000',
      '/log': 'http://localhost:8000',
    },
  },
})
