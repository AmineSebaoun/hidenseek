// src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useSessionStore } from '@/stores/session'
import { useTimeStore } from '@/stores/time'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

// hydrate la session (ton store existant)
useSessionStore(pinia).loadFromStorage?.()

// ⏱️ démarre la sync d'horloge (toutes les 15s)
useTimeStore(pinia).start(15000)

app.use(router)
app.mount('#app')
