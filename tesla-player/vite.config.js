import { createHash } from 'node:crypto'
import { join, sep } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import vue from '@vitejs/plugin-vue'
import postcss from 'postcss'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// the physics' code as a stamp: the coils' responses a page keeps between sessions are
// thrown away when it changes (src/app/physics-store.ts)
function physicsStamp() {
  const root = fileURLToPath(new URL('./src/model/coils/', import.meta.url))
  const files = ['response.ts', ...readdirSync(`${root}physics`, { recursive: true }).map((f) => `physics/${f}`)]
    .map((f) => f.split(sep).join('/')).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')).sort()
  const h = createHash('sha256')
  for (const f of files) h.update(f).update(readFileSync(`${root}${f}`))
  return h.digest('hex').slice(0, 12)
}

// the documentation, at the repository's root: the site renders it (src/site/docs.ts)
const DOCS = fileURLToPath(new URL('../docs', import.meta.url))

/**
 * Font Awesome's 2,000-odd icons cut to the ones named in the code, the pages and the
 * docs: its stylesheet goes from 110 kB to a few. A build's only: the dev server keeps
 * them all, an icon just added shows at once.
 */
function iconSubset() {
  const used = new Set()
  const scan = (text) => {
    for (const m of text.matchAll(/fa-[a-z0-9]+(?:-[a-z0-9]+)*/g)) used.add(m[0])
  }
  return {
    name: 'icon-subset',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      used.clear()
      for (const root of [fileURLToPath(new URL('./src', import.meta.url)), DOCS]) {
        for (const f of readdirSync(root, { recursive: true })) {
          if (/\.(vue|ts|js|scss|md)$/.test(f)) scan(readFileSync(join(root, f), 'utf8'))
        }
      }
      for (const page of ['./index.html', './site.html']) scan(readFileSync(new URL(page, import.meta.url), 'utf8'))
    },
    transform(code, id) {
      if (!id.split(sep).join('/').includes('@fortawesome/fontawesome-free/css/all.css')) return null
      const root = postcss.parse(code)
      // an icon's rule gives its glyph alone (--fa), under its name and its aliases
      root.walkRules((rule) => {
        if (!rule.nodes.length || !rule.nodes.every((n) => n.type === 'decl' && n.prop === '--fa')) return
        const keep = rule.selectors.filter((s) => used.has(s.slice(1)))
        if (keep.length) rule.selectors = keep
        else rule.remove()
      })
      return { code: root.toString(), map: null }
    },
  }
}

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
    plugins: [vue(), iconSubset(), ...(site ? [sitePages()] : [])],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // Use the full build so runtime message compilation works (messages
        // are plain JS objects in src/ui/translations/, one file per language).
        'vue-i18n': 'vue-i18n/dist/vue-i18n.esm-bundler.js'
      }
    },
    define: {
      __VUE_I18N_FULL_INSTALL__: true,
      __VUE_I18N_LEGACY_API__: true,
      __INTLIFY_PROD_DEVTOOLS__: false,
      __APP_VERSION__: JSON.stringify(pkg.version),
      __PHYSICS_STAMP__: JSON.stringify(physicsStamp())
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
