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

    <!-- LOBBY -->
    <div v-if="isInLobby" class="panel">
      <div class="lobby-header">
        <div>
          <div class="muted">Code de la partie</div>
          <div class="code-big">{{ session.game?.code || createdGame?.code }}</div>
        </div>
        <div class="lobby-actions">
          <button class="btn" @click="copy(session.game?.code || createdGame?.code)">Copier le code</button>
          <button class="btn" @click="randomizeRoles" :disabled="savingRoles || !players.length">Rôles aléatoires</button>
          <button class="btn" @click="rulesOpen = true">⚙️ Règles</button>
          <button class="btn ghost" @click="refreshPlayers" :disabled="savingRoles">Rafraîchir</button>
        </div>
      </div>

      <div class="players">
        <div class="row head">
          <div>Joueur</div>
          <div>Rôle</div>
          <div></div>
        </div>

        <div v-for="p in players" :key="p.id" class="row">
          <div class="name">{{ p.name }}</div>
          <div>
            <select :value="p.role" @change="onChangeRole(p, $event.target.value)" :disabled="savingRoles">
              <option value="seeker">Chercheur</option>
              <option value="hider">Cacheur</option>
            </select>
          </div>
          <div class="tiny-muted" v-if="p.id === session.player?.id">(moi)</div>
        </div>

        <p v-if="players.length === 0" class="muted">En attente de joueurs…</p>
      </div>
    </div>

    <!-- Modale des règles : POPUP au-dessus de la page -->
    <RulesModal :open="rulesOpen" @close="rulesOpen=false" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useSessionStore } from '@/stores/session'
import { useGameStore } from '@/stores/game'
import { useRulesStore } from '@/stores/rules'
import RulesModal from '@/components/RulesModal.vue'

const session = useSessionStore()
const game = useGameStore()
const rulesStore = useRulesStore()

const mode = ref(null)
const createdGame = ref(null)
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

// lobby
const players = ref([])
const pollId = ref(null)
const savingRoles = ref(false)

// modale règles
const rulesOpen = ref(false)

/* ---------- Flux ---------- */
async function onCreateAndJoin () {
  errorCreate.value = ''
  loadingCreate.value = true
  try {
    const created = await game.createGame(createName.value) // { game }
    createdGame.value = created.game

    const joined = await game.joinGame({
      code: createdGame.value.code,
      name: creatorName.value,
      role: 'hider'
    })
    session.setAuth(joined.token, joined.player, joined.game)
    startLobbyPolling()
  } catch (e) {
    console.error(e)
    errorCreate.value = e?.message || 'Erreur lors de la création.'
  } finally {
    loadingCreate.value = false
  }
}

async function onJoin () {
  errorJoin.value = ''
  loadingJoin.value = true
  try {
    const joined = await game.joinGame({
      code: joinCode.value,
      name: joinName.value,
      role: 'hider'
    })
    session.setAuth(joined.token, joined.player, joined.game)
    startLobbyPolling()
  } catch (e) {
    console.error(e)
    errorJoin.value = e?.message || 'Impossible de rejoindre.'
  } finally {
    loadingJoin.value = false
  }
}

function startLobbyPolling(){
  refreshPlayers()
  stopLobbyPolling()
  pollId.value = setInterval(refreshPlayers, 2500)
}
function stopLobbyPolling(){
  if (pollId.value) { clearInterval(pollId.value); pollId.value = null }
}
onMounted(() => { if (isInLobby.value) startLobbyPolling() })
onBeforeUnmount(stopLobbyPolling)

async function refreshPlayers(){
  try {
    const res = await game.getPlayers() // { players: [...] }
    players.value = res.players || []
  } catch (e) {
    console.error('getPlayers failed', e)
  }
}

async function onChangeRole(p, role){
  try {
    savingRoles.value = true
    await game.setRole(p.id, role)
    await refreshPlayers()
  } catch (e) {
    console.error('setRole failed', e)
  } finally {
    savingRoles.value = false
  }
}

async function randomizeRoles(){
  if (!players.value.length) return
  savingRoles.value = true
  try {
    const shuffled = [...players.value].sort(() => Math.random() - 0.5)
    const half = Math.floor(shuffled.length / 2)
    const seekers = new Set(shuffled.slice(0, half).map(p => p.id))
    for (const p of shuffled) {
      const target = seekers.has(p.id) ? 'seeker' : 'hider'
      if (p.role !== target) await game.setRole(p.id, target)
    }
    await refreshPlayers()
  } catch (e) {
    console.error('randomizeRoles failed', e)
  } finally {
    savingRoles.value = false
  }
}

function copy(text){ if(text) navigator.clipboard?.writeText(text).catch(()=>{}) }

function reset() {
  mode.value = null
  createdGame.value = null
  createName.value = ''
  creatorName.value = ''
  joinCode.value = ''
  joinName.value = ''
  errorCreate.value = ''
  errorJoin.value = ''
}

/* Charger les règles à l’ouverture de la popup */
watch(rulesOpen, (open) => {
  if (open) rulesStore.fetchRules().catch(() => {
  })
})
</script>

<style scoped>
.home {
  max-width: 900px;
  margin: 40px auto;
  padding: 16px;
}

.title {
  font-size: 32px;
  margin-bottom: 12px;
  font-weight: 800;
}

.banner {
  border: 1px solid #2c2c2c;
  background: #0f1115;
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 16px;
}

.banner-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.muted {
  opacity: .7;
  font-size: 12px;
}

.tiny-muted {
  opacity: .6;
  font-size: 12px;
}

.choice {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.panel {
  margin-top: 12px;
  padding: 16px;
  border: 1px solid #2f2f2f;
  border-radius: 10px;
  background: #111;
}

.field {
  display: grid;
  gap: 6px;
  margin: 12px 0;
}

.field > span {
  font-size: 14px;
  opacity: .85;
}

input, select {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #3b3b3b;
  background: #0d0d0d;
  color: #eee;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.btn {
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid #3b3b3b;
  background: #1b1b1b;
  color: #eee;
  cursor: pointer;
}

.btn.primary {
  background: #10b981;
  border-color: #10b981;
  color: #07130e;
  font-weight: 700;
}

.btn.ghost {
  background: transparent;
}

.btn.tiny {
  padding: 6px 10px;
}

.code {
  background: #222;
  padding: 3px 6px;
  border-radius: 6px;
  font-family: monospace;
}

.code-big {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 800;
  font-size: 36px;
  letter-spacing: 2px;
  background: #0b0b0b;
  border: 1px dashed #2f2f2f;
  border-radius: 12px;
  padding: 10px 14px;
  display: inline-block;
}

.lobby-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.lobby-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.players {
  margin-top: 16px;
}

.row {
  display: grid;
  grid-template-columns: 1.6fr 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px dashed #2a2a2a;
}

.row.head {
  font-weight: 700;
  border-bottom: 1px solid #2a2a2a;
}

.name {
  font-weight: 600;
}

.error {
  color: #ff6b6b;
  margin-top: 8px;
}
</style>
