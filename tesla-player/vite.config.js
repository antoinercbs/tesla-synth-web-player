import { fileURLToPath, URL } from 'node:url'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import vue from '@vitejs/plugin-vue'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
// the documentation, at the repository's root: the site renders it (src/site/docs.ts)
const DOCS = fileURLToPath(new URL('../docs', import.meta.url))

/**
 * The GitHub Pages build (`--mode site`): site.html becomes the index, and every
 * page gets a copy of it at its own path, so a link to /docs/tuning answers 200
 * (404.html catches the rest).
 */
function sitePages() {
  const out = fileURLToPath(new URL('./dist-site/', import.meta.url))
  return {
    name: 'site-pages',
    apply: 'build',
    closeBundle() {
      renameSync(`${out}site.html`, `${out}index.html`)
      const guides = readdirSync(DOCS)
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .map((f) => `docs/${f.slice(0, -3)}`)
      for (const page of ['demos', 'download', 'docs', 'credits', ...guides]) {
        mkdirSync(`${out}${page}`, { recursive: true })
        copyFileSync(`${out}index.html`, `${out}${page}/index.html`)
      }
      copyFileSync(`${out}index.html`, `${out}404.html`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const site = mode === 'site'
  return {
    // GitHub Pages serves the site under the repository's name
    base: site ? (process.env.SITE_BASE ?? '/tesla-synth-web-player/') : '/',
    plugins: [vue(), ...(site ? [sitePages()] : [])],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // Use the full build so runtime message compilation works (messages
        // are plain JS objects in src/assets/translations/, one file per language).
        'vue-i18n': 'vue-i18n/dist/vue-i18n.esm-bundler.js'
      }
    },
    define: {
      __VUE_I18N_FULL_INSTALL__: true,
      __VUE_I18N_LEGACY_API__: true,
      __INTLIFY_PROD_DEVTOOLS__: false,
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    css: {
      preprocessorOptions: {
        scss: {
          // the partials are brought in with @import, in an order the cascade depends on
          silenceDeprecations: ['import']
        }
      }
    },
    server: {
      port: 8080,
      fs: { allow: [searchForWorkspaceRoot(process.cwd()), DOCS] }
    },
    build: site
      ? {
          outDir: 'dist-site',
          emptyOutDir: true,
          rollupOptions: { input: fileURLToPath(new URL('./site.html', import.meta.url)) }
        }
      : undefined
  }
})
