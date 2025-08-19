import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useSessionStore } from './stores/session'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

// ⬇️ rehydrate session avant de monter l'app
const session = useSessionStore()
session.loadFromStorage()

app.use(router)
app.mount('#app')

// (optionnel) sync multi-onglets
window.addEventListener('storage', (e) => {
    if (e.key === 'hns_session_v1') session.loadFromStorage()
})
