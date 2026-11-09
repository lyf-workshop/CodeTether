import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __CODETETHER_PRODUCT_VERSION__: JSON.stringify(version),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})
