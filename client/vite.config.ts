import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Stamps the build's version into dist/sw.js: a hash of the list of built
 * files, so a new deploy is a new service worker (and the same files keep the
 * same one, wherever the commit came from).
 */
function stampServiceWorker(): Plugin {
  let outDir = 'dist'
  return {
    name: 'melio-stamp-service-worker',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
    closeBundle() {
      const manifest = resolve(outDir, 'asset-manifest.json')
      const sw = resolve(outDir, 'sw.js')
      if (!existsSync(manifest) || !existsSync(sw)) return
      const version = createHash('sha1').update(readFileSync(manifest)).digest('hex').slice(0, 12)
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('__MELIO_SW_VERSION__', version))
    },
  }
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    // Lists every built file, so the service worker can keep them all for offline use.
    manifest: 'asset-manifest.json',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          icons: ['lucide-react'],
        },
      },
    },
  },
})
