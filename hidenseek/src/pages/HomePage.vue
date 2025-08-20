<!-- src/views/Home.vue (ou src/pages/Home.vue selon ton arbo) -->
<template>
  <div class="home">
    <h1 class="title">🎮 HideNSeek</h1>

    <!-- Bandeau si une partie est déjà connue -->
    <div v-if="session.game?.code" class="banner">
      <div class="banner-row">
        <span>Partie :</span>
        <strong class="code">{{ session.game.code }}</strong>
        <button class="btn tiny" @click="copy(session.game.code)">Copier</button>
        <span class="muted">État : {{ session.game.state || 'pending' }}</span>
      </div>
    </div>

    <!-- Choix initial -->
    <div v-if="!mode && !isInLobby" class="choice">
      <button class="btn primary" @click="mode='create'">Créer une partie</button>
      <button class="btn" @click="mode='join'">Rejoindre une partie</button>
    </div>

    <!-- CRÉER -->
    <form v-if="mode==='create' && !isInLobby" class="panel" @submit.prevent="onCreateAndJoin">
      <h2>Créer une partie</h2>
      <label class="field">
        <span>Nom de la partie</span>
        <input v-model.trim="createName" type="text" placeholder="Ex: Soirée du vendredi" required />
      </label>
      <label class="field">
        <span>Ton pseudo</span>
        <input v-model.trim="creatorName" type="text" placeholder="Ton nom" required />
      </label>
      <div class="actions">
        <button class="btn primary" :disabled="loadingCreate">
          <span v-if="!loadingCreate">Créer et rejoindre</span><span v-else>…</span>
        </button>
        <button class="btn ghost" type="button" @click="reset()">Retour</button>
      </div>
      <p v-if="errorCreate" class="error">{{ errorCreate }}</p>
    </form>

    <!-- REJOINDRE -->
    <form v-if="mode==='join' && !isInLobby" class="panel" @submit.prevent="onJoin">
      <h2>Rejoindre une partie</h2>
      <label class="field">
        <span>Code</span>
        <input v-model.trim="joinCode" type="text" placeholder="Ex: 8FBF59" maxlength="6" required />
      </label>
      <label class="field">
        <span>Pseudo</span>
        <input v-model.trim="joinName" type="text" placeholder="Ton nom" required />
      </label>
      <div class="actions">
        <button class="btn primary" :disabled="loadingJoin">
          <span v-if="!loadingJoin">Rejoindre</span><span v-else>…</span>
        </button>
        <button class="btn ghost" type="button" @click="reset()">Retour</button>
      </div>
      <p v-if="errorJoin" class="error">{{ errorJoin }}</p>
    </form>

    <!-- LOBBY (affiché exactement où il était avant) -->
    <Lobby v-if="isInLobby" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useSessionStore } from '@/stores/session'
import { useGameStore } from '@/stores/game'
import Lobby from '@/components/Lobby.vue'

const session = useSessionStore()
const game = useGameStore()

const mode = ref(null)
const isInLobby = computed(() => !!session.game?.id)

// création
const createName = ref('')
const creatorName = ref('')
const loadingCreate = ref(false)
const errorCreate = ref('')

// rejoindre
const joinCode = ref('')
const joinName = ref('')
const loadingJoin = ref(false)
const errorJoin = ref('')

function copy(text){ if(text) navigator.clipboard?.writeText(text).catch(()=>{}) }
function reset(){
  mode.value = null
  createName.value = ''
  creatorName.value = ''
  joinCode.value = ''
  joinName.value = ''
  errorCreate.value = ''
  errorJoin.value = ''
}

/* Création + join */
async function onCreateAndJoin () {
  errorCreate.value = ''
  loadingCreate.value = true
  try {
    const created = await game.createGame(createName.value)
    const joined = await game.joinGame({ code: created.game.code, name: creatorName.value, role: 'hider' })
    session.setAuth(joined.token, joined.player, joined.game)
  } catch (e) {
    console.error(e)
    errorCreate.value = e?.message || 'Erreur lors de la création.'
  } finally { loadingCreate.value = false }
}

async function onJoin () {
  errorJoin.value = ''
  loadingJoin.value = true
  try {
    const joined = await game.joinGame({ code: joinCode.value, name: joinName.value, role: 'hider' })
    session.setAuth(joined.token, joined.player, joined.game)
  } catch (e) {
    console.error(e)
    errorJoin.value = e?.message || 'Impossible de rejoindre.'
  } finally { loadingJoin.value = false }
}

/* Si on est viré, le store émet un event → on revient au menu */
const kickedHandled = ref(false)
function onKicked(){
  if (kickedHandled.value) return
  kickedHandled.value = true
  mode.value = null
}
watch(() => game.kicked, (v) => { if (v) onKicked() })
function kickedEvtHandler(){ onKicked() }
onMounted(() => { window.addEventListener('hidenseek:kicked', kickedEvtHandler) })
onBeforeUnmount(() => { window.removeEventListener('hidenseek:kicked', kickedEvtHandler) })
</script>

<style scoped>
.home { max-width: 900px; margin: 40px auto; padding: 16px; }
.title { font-size: 32px; margin-bottom: 12px; font-weight: 800; }

.banner { border:1px solid #2c2c2c; background:#0f1115; border-radius:10px; padding:10px 12px; margin-bottom:16px; }
.banner-row { display:flex; align-items:center; gap:10px; }
.muted { opacity:.7; font-size:12px; }
.btn { padding:10px 14px; border-radius:8px; border:1px solid #3b3b3b; background:#1b1b1b; color:#eee; cursor:pointer; }
.btn.primary { background:#10b981; border-color:#10b981; color:#07130e; font-weight:700; }
.btn.ghost { background:transparent; }
.btn.tiny { padding:6px 10px; }

.choice { display:flex; gap:12px; margin-top:16px; }
.panel { margin-top:12px; padding:16px; border:1px solid #2f2f2f; border-radius:10px; background:#111; }

.field { display:grid; gap:6px; margin:12px 0; }
.field > span { font-size:14px; opacity:.85; }
input, select { padding:10px 12px; border-radius:8px; border:1px solid #3b3b3b; background:#0d0d0d; color:#eee; }

.actions { display:flex; gap:10px; margin-top:12px; }
.error { color:#ff6b6b; margin-top:8px; }
.code { background:#222; padding:3px 6px; border-radius:6px; font-family:monospace; }
</style>
