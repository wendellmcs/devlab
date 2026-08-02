import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const ALVO = `http://127.0.0.1:${process.env['DEVLAB_PORTA'] ?? 7788}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: ALVO, changeOrigin: false },
      '/ws': { target: ALVO, ws: true, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
