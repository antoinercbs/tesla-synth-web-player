import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import axios from 'axios'
import VueAxios from 'vue-axios'

import App from './App.vue'
import router from './router'
import { messages } from './assets/translations'
import { useAuthStore } from '@/stores/auth'
import { getAccessToken, isAuthEnabled, tryRenew } from '@/auth/oidc'

import '@/assets/main.scss'
// CSS webfont only — do NOT also import the JS build: its SVG auto-replacement
// of <i> elements fights Vue's reactive re-renders and makes icons disappear.
import '@fortawesome/fontawesome-free/css/all.css'

axios.defaults.baseURL = import.meta.env.VITE_BASE_URL

// Attach the OIDC bearer token when one is present. Inert when auth is off or
// the user is logged out (getAccessToken() returns null), so the no-auth path
// is unchanged.
axios.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// On 401 with auth enabled: first try a SILENT token renewal and retry the
// request once — this recovers a mid-session token expiry in place, WITHOUT a
// full-page re-login that would lose unsaved edits. Only if renewal fails (the
// session is genuinely gone) do we redirect to the IdP. The anti-loop guard in
// requestLogin falls back to the manual /login page if the round-trip isn't
// yielding a usable session. Errors still propagate so callers see the failure.
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error && error.response && error.response.status
    const cfg = error && error.config
    if (isAuthEnabled() && status === 401 && cfg && !cfg.__authRetried) {
      cfg.__authRetried = true
      const token = await tryRenew()
      if (token) {
        // Re-issue the original request; the request interceptor attaches the
        // freshly-renewed token. No navigation, no lost state.
        return axios(cfg)
      }
      const auth = useAuthStore()
      auth.markExpired()
      const current = router.currentRoute.value
      if (current.name !== 'login' && current.name !== 'auth-callback') {
        const redirect = current.fullPath
        auth.requestLogin(redirect)
          .then((redirected) => {
            if (!redirected) {
              router.replace({ name: 'login', query: redirect ? { redirect } : {} }).catch(() => {})
            }
          })
          .catch(() => {})
      }
    } else if (isAuthEnabled() && status === 403) {
      // Authenticated but lacking the required role → show an access-denied wall
      // (NOT a re-login: a fresh token would have the same roles and loop).
      useAuthStore().markAccessDenied()
      if (router.currentRoute.value.name !== 'login') {
        router.replace({ name: 'login' }).catch(() => {})
      }
    }
    return Promise.reject(error)
  }
)

const i18n = createI18n({
  legacy: true,
  locale: localStorage.getItem('locale') || 'en',
  fallbackLocale: 'en',
  messages
})

async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  // Learn whether the server requires login BEFORE the router guard and the
  // App.vue data bootstrap run, so the first frame never fires guaranteed-401
  // requests. Degrades to "auth off" if the server can't be reached.
  await useAuthStore().init()

  app.use(router)
  app.use(VueAxios, axios)
  app.use(i18n)

  app.mount('#app')
}

bootstrap()
