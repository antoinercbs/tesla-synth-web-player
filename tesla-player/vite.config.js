import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Use the full build so runtime message compilation works (messages
      // are provided as a plain JS object in src/assets/translations.js).
      'vue-i18n': 'vue-i18n/dist/vue-i18n.esm-bundler.js'
    }
  },
  define: {
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: true,
    __INTLIFY_PROD_DEVTOOLS__: false
  },
  css: {
    preprocessorOptions: {
      scss: {
        // bulma-slider's sass imports bulma via "node_modules/bulma/..."
        // paths, which only resolve when node_modules' parent (the project
        // root) is on the sass load path.
        loadPaths: [fileURLToPath(new URL('.', import.meta.url))],
        silenceDeprecations: [
          'import',
          'global-builtin',
          'color-functions',
          'if-function'
        ]
      }
    }
  },
  server: {
    port: 8080
  }
})
