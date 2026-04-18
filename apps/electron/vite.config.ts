import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'


export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          // Jotai HMR support: caches atom instances in globalThis.jotaiAtomCache
          // so that HMR module re-execution returns stable atom references
          // instead of creating new (empty) atoms that orphan existing data.
          'jotai/babel/plugin-debug-label',
          ['jotai/babel/plugin-react-refresh', { customAtomNames: ['atomFamily'] }],
        ],
      },
    }),
    tailwindcss(),
  ],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    // Clear output directory before write (Vite option name: emptyOutDir)
    emptyOutDir: true,
    sourcemap: true,  // Source maps generated for debugging.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        playground: resolve(__dirname, 'src/renderer/playground.html'),
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      // Renderer-safe models shim: avoids pulling storage.ts (fs/path/crypto) via re-exports
      '@config/models': resolve(__dirname, 'src/renderer/shims/config-models.browser.ts'),
      '@config': resolve(__dirname, '../../packages/shared/src/config'),
      // Prevent Node-only credential storage from being bundled into the renderer.
      // Any accidental imports of @opentomo/shared/credentials in renderer code
      // will resolve to a browser stub that throws if actually used at runtime.
      '@opentomo/shared/credentials': resolve(__dirname, 'src/renderer/shims/shared-credentials.browser.ts'),
      // Schedules package: only expose browser-safe cron utilities to the renderer.
      // storage.ts imports fs/path (Node.js-only) and must not be bundled into the renderer.
      '@opentomo/shared/schedules': resolve(__dirname, '../../packages/shared/src/schedules/cron-utils.ts'),
      // Widget utilities: packages/ui imports from @opentomo/shared/widget but doesn't declare it
      // as a dependency. Direct alias bypasses Vite's import-analysis package resolution.
      '@opentomo/shared/widget': resolve(__dirname, '../../packages/shared/src/widget/index.browser.ts'),
      // Force all React imports to use the root node_modules React
      // Bun hoists deps to root. This prevents "multiple React copies" error from @opentomo/ui
      'react': resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'jotai', 'pdfjs-dist'],
    exclude: ['@opentomo/ui'],
    esbuildOptions: {
      supported: { 'top-level-await': true },
      target: 'esnext'
    }
  },
  server: {
    port: 15173,
    open: false
  }
})
