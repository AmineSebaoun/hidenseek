<template>
  <main class="container">
    <h1>🏁 Partie en cours</h1>
    <p>Bienvenue, {{ session.player?.name }}</p>
    <p>Rôle : {{ session.player?.role }}</p>
    <p>Équipe : {{ session.player?.team }}</p>

    <button @click="leave">Quitter la partie</button>
  </main>
</template>

<script setup>
import {useSessionStore} from '../stores/session'
import {useRouter} from 'vue-router'

const session = useSessionStore()
const router = useRouter()

const leave = () => {
  session.logout()
  router.push('/')
}
</script>

<style scoped>
.container {
  max-width: 500px;
  margin: 40px auto;
  padding: 16px;
}

button {
  margin-top: 20px;
  padding: 10px 20px;
  background: #b00020;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

button:hover {
  background: #d32f2f;
}
</style>
