import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'
import GamePage from '@/pages/GamePage.vue'
import { useSessionStore } from '@/stores/session'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    // protège cette route avec un flag meta
    { path: '/game', name: 'game', component: GamePage, meta: { requireGame: true } },
  ],
})

router.beforeEach((to) => {
  const session = useSessionStore()
  // hydrate au cas où (sécurisé, fait rien si déjà chargé)
  session.loadFromStorage?.()

  if (to.meta?.requireGame) {
    // pas de token OU pas de game -> retour accueil
    if (!session.isAuthenticated || !session.gameId) {
      return { name: 'home' }
    }
  }
  return true
})

export default router
