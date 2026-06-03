import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Technigala live demo (2026-06-03): proxy live endpoints to the device's AP.
// Device softAP "Ventis" → gateway 192.168.4.1 (ESP32 default). Join that AP,
// then `npm run build && npm run preview` (or `npm run dev`). Browser hits
// localhost → Vite forwards to the device → same-origin, no CORS, no firmware change.
// NOTE: /history is deliberately NOT proxied — Trends uses mock (device keeps only
// a 5-min ring buffer; see fetchHistory pin in api.ts). Set VENTIS_DEVICE=http://<ip>
// to override (e.g. point at a local mock server on :8000 for offline UI work).
const DEVICE = process.env.VENTIS_DEVICE ?? 'http://192.168.4.1'
const liveProxy = {
  '/data': DEVICE,
  '/insight': DEVICE,
  '/control': DEVICE,
  '/log': DEVICE,
}

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
  server: { port: 5173, proxy: liveProxy },
  preview: { port: 4173, proxy: liveProxy },
})
