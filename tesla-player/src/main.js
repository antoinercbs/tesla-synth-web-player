import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import axios from 'axios'
import VueAxios from 'vue-axios'

import App from './App.vue'
import router from './router'
import { messages } from './assets/translations'

import '@/assets/main.scss'
// CSS webfont only — do NOT also import the JS build: its SVG auto-replacement
// of <i> elements fights Vue's reactive re-renders and makes icons disappear.
import '@fortawesome/fontawesome-free/css/all.css'

axios.defaults.baseURL = import.meta.env.VITE_BASE_URL

const i18n = createI18n({
  legacy: true,
  locale: localStorage.getItem('locale') || 'en',
  fallbackLocale: 'en',
  messages
})

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(VueAxios, axios)
app.use(i18n)

app.mount('#app')
