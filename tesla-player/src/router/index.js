import { createRouter, createWebHistory } from 'vue-router'
import PlayerView from '@/views/PlayerView.vue'

const routes = [
  {
    path: '/',
    name: 'player',
    component: PlayerView
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router
