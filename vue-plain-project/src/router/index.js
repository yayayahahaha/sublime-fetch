import { createWebHistory, createRouter } from 'vue-router'

import HomeView from '@/pages/HomeView.vue'
import AboutView from '@/pages/AboutView.vue'

const routes = [
  { name: 'home', path: '/', component: HomeView },
  { name: 'about', path: '/about', component: AboutView },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
