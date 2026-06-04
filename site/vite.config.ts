import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Site deploys from this `site/` subdirectory on Vercel (set Root Directory = site).
export default defineConfig({
  plugins: [react()],
})
