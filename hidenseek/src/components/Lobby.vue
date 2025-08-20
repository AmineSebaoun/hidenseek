<template>
  <div class="panel">
    <div class="lobby-header">
      <div>
        <div class="muted">Code de la partie</div>
        <div class="code-big">{{ session.game?.code }}</div>
      </div>
      <div class="lobby-actions">
        <button class="btn" @click="copy(session.game?.code)">Copier le code</button>
        <button class="btn" @click="randomizeRoles" :disabled="savingRoles || !players.length">Rôles aléatoires</button>
        <button class="btn" @click="openRules()">⚙️ Règles</button>
        <button class="btn ghost" @click="refreshPlayers" :disabled="savingRoles">Rafraîchir</button>
      </div>
    </div>

    <div class="players">
      <div class="row head">
        <div>Joueur</div>
        <div>Rôle</div>
        <div class="text-right">Actions</div>
      </div>

      <div v-for="(p, idx) in players" :key="p.id" class="row">
        <div class="name">
          <span v-if="idx === 0" class="host-badge" title="Créateur/Host">👑</span>
          {{ p.name }}
          <span class="tiny-muted" v-if="p.id === session.player?.id">(moi)</span>
        </div>

        <div>
          <select :value="p.role" @change="onChangeRole(p, $event.target.value)" :disabled="savingRoles">
            <option value="seeker">Chercheur</option>
            <option value="hider">Cacheur</option>
          </select>
        </div>

        <div class="text-right">
          <button
            v-if="isHost && p.id !== session.player?.id"
            class="btn tiny danger"
            :disabled="savingRoles || kickingId === p.id"
            @click="kickPlayer(p)"
            :title="'Retirer ' + p.name"
          >
            <span v-if="kickingId !== p.id">Retirer</span>
            <span v-else>…</span>
          </button>
        </div>
      </div>

      <p v-if="players.length === 0" class="muted">En attente de joueurs…</p>
    </div>

    <!-- Actions bas -->
    <div class="lobby-launch">
      <!-- Lancer : host uniquement -->
      <button
        v-if="isHost"
        class="btn primary"
        :disabled="!canLaunch"
        @click="launchGame"
        :title="launchTooltip"
      >
        Lancer la partie
      </button>
      <span v-else class="muted">En attente du chef pour lancer la partie…</span>

      <!-- Quitter -->
      <button class="btn danger" :disabled="quitting || savingRoles" @click="quitGame">
        <span v-if="!quitting">Quitter la partie</span>
        <span v-else>…</span>
      </button>

      <div class="lobby-hints">
        <span :class="['pill', hasMinPlayers ? 'ok' : 'ko']">
          Joueurs: {{ playersCount }} / 3
        </span>
        <span :class="['pill', timelineValid ? 'ok' : 'ko']">
          Frise: {{ timelineValid ? 'OK' : 'Invalide' }}
        </span>
        <span :class="['pill', hasRolesMin ? 'ok' : 'ko']" :title="rolesLabel">
          Rôles: {{ rolesShort }}
        </span>
      </div>

      <p class="muted" v-if="validationMessage">⚠️ {{ validationMessage }}</p>
    </div>

    <!-- Modale règles -->
    <RulesModal
      :open="rulesOpen"
      :token="session.token"
      :game-id="session.game?.id"
      @close="rulesOpen = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import Swal from 'sweetalert2'
import 'sweetalert2/dist/sweetalert2.min.css'
import { useSessionStore } from '@/stores/session'
import { useGameStore } from '@/stores/game'
import { useRulesStore } from '@/stores/rules'
import RulesModal from '@/components/RulesModal.vue'

const session = useSessionStore()
const game = useGameStore()
const rulesStore = useRulesStore()

const toast = Swal.mixin({ toast:true, position:'top-end', showConfirmButton:false, timer:2000, timerProgressBar:true })

/* state */
const players = ref([])
const pollId = ref(null)
const savingRoles = ref(false)
const kickingId = ref(null)
const quitting = ref(false)
const rulesOpen = ref(false)

/* helpers */
function copy (text) { if (text) navigator.clipboard?.writeText(text).catch(()=>{}) }

/* polling */
function startLobbyPolling(){ refreshPlayers(); stopLobbyPolling(); pollId.value = setInterval(refreshPlayers, 2500) }
function stopLobbyPolling(){ if (pollId.value) { clearInterval(pollId.value); pollId.value = null } }
onMounted(async () => { await ensureRulesLoaded(); startLobbyPolling() })
onBeforeUnmount(stopLobbyPolling)

async function refreshPlayers(){
  try {
    const res = await game.getPlayers()
    players.value = res.players || []
  } catch (e) {
    if (String(e?.message || '').includes('kicked')) return
    console.error('getPlayers failed', e)
  }
}

/* host local = 1er joueur */
const hostId = computed(() => players.value[0]?.id || null)
const isHost = computed(() => !!session.player?.id && session.player.id === hostId.value)

/* rôles */
async function onChangeRole(p, role){
  try {
    savingRoles.value = true
    await game.setRole(p.id, role)
    await refreshPlayers()
  } catch (e) {
    if (!String(e?.message || '').includes('kicked')) console.error('setRole failed', e)
  } finally { savingRoles.value = false }
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
    if (!String(e?.message || '').includes('kicked')) console.error('randomizeRoles failed', e)
  } finally { savingRoles.value = false }
}

/* virer */
async function kickPlayer(p){
  if (!isHost.value) return
  if (!confirm(`Retirer ${p.name} de la partie ?`)) return
  try {
    kickingId.value = p.id
    await game.removePlayer(p.id)
    await refreshPlayers()
    toast.fire({ icon:'success', title: `${p.name} a été retiré` })
  } catch (e) {
    if (String(e?.message || '').includes('kicked')) return
    Swal.fire({ icon:'error', title:'Échec', text:"Impossible de retirer ce joueur." })
  } finally { kickingId.value = null }
}

/* règles */
async function ensureRulesLoaded(){ try { await rulesStore.fetchCatalog() } catch {} try { await rulesStore.fetchRules() } catch {} }
function openRules(){ rulesOpen.value = true }

/* ---- Contraintes lancement ---- */
const playersCount = computed(() => Number(players.value?.length || 0))
const hasMinPlayers = computed(() => playersCount.value >= 3)

// ⇩ nouveau: contrainte rôles
const countSeekers = computed(() => players.value.filter(p => p.role === 'seeker').length)
const countHiders  = computed(() => players.value.filter(p => p.role === 'hider').length)
const hasRolesMin  = computed(() => countSeekers.value >= 1 && countHiders.value >= 1)
const rolesLabel   = computed(() => `${countSeekers.value} chercheur(s), ${countHiders.value} cacheur(s)`)
const rolesShort   = computed(() => hasRolesMin.value ? 'OK' : `${countSeekers.value}/${countHiders.value}`)

const timelineValid = computed(() => {
  const endGame = Number(rulesStore.game?.max_duration_sec || 0)
  for (const ev of rulesStore.timeline) {
    if (ev.type !== 'end') {
      const t = Number(ev.time) || 0
      const d = Math.max(0, Number(ev.duration_sec) || 0)
      if (d < 0 || t < 0) return false
      if (endGame > 0 && (t >= endGame || t + d > endGame)) return false
      const overlap = rulesStore.timeline.some(other => {
        if (other === ev || other.type === 'end') return false
        const a1 = Number(other.time) || 0
        const a2 = a1 + (Number(other.duration_sec) || 0)
        const b1 = t, b2 = t + d
        return a1 < b2 && b1 < a2
      })
      if (overlap) return false
    } else if (endGame > 0 && ev.time !== endGame) {
      return false
    }
  }
  return true
})

const canLaunch = computed(() =>
  isHost.value && hasMinPlayers.value && hasRolesMin.value && timelineValid.value && !savingRoles.value
)

const launchTooltip = computed(() => {
  if (!isHost.value) return 'Seul le chef peut lancer'
  if (!hasMinPlayers.value) return 'Minimum 3 joueurs requis'
  if (!hasRolesMin.value) return 'Au moins 1 chercheur ET 1 cacheur requis'
  if (!timelineValid.value) return 'Corrige la frise'
  return 'Prêt à lancer'
})

async function launchGame () {
  if (!canLaunch.value) {
    Swal.fire({ icon:'info', title:'Conditions non remplies',
      text:'Il faut au moins 1 Chercheur et 1 Cacheur, 3 joueurs, et une frise valide.' })
    return
  }
  await game.startGame()
  toast.fire({ icon:'success', title:'Partie lancée' })
}

/* quitter */
async function quitGame(){
  if (!session.game?.id || !session.player?.id) return
  if (!confirm('Quitter la partie ?')) return
  quitting.value = true
  try {
    await game.removePlayer()
    stopLobbyPolling()
    players.value = []
    session.token = null
    session.player = null
    session.game = null
    toast.fire({ icon:'success', title:'Vous avez quitté la partie' })
  } catch (e) {
    if (String(e?.message || '').includes('kicked')) return
    Swal.fire({ icon:'error', title:'Échec', text:'Impossible de quitter la partie.' })
  } finally { quitting.value = false }
}

/* message aide */
const validationMessage = computed(() => {
  if (!hasMinPlayers.value) return 'Minimum 3 joueurs requis pour lancer la partie.'
  if (!hasRolesMin.value)   return 'Répartis les rôles : au moins 1 Chercheur et 1 Cacheur.'
  if (!timelineValid.value) return 'La configuration de la frise est invalide (chevauchement ou borne fin).'
  return ''
})
</script>

<style scoped>
.panel { margin-top:12px; padding:16px; border:1px solid #2f2f2f; border-radius:10px; background:#111; }
.muted { opacity:.7; font-size:12px; }
.tiny-muted { opacity:.6; font-size:12px; }
.btn { padding:10px 14px; border-radius:8px; border:1px solid #3b3b3b; background:#1b1b1b; color:#eee; cursor:pointer; }
.btn.primary { background:#10b981; border-color:#10b981; color:#07130e; font-weight:700; }
.btn.ghost { background:transparent; }
.btn.tiny { padding:6px 10px; font-size:12px; }
.btn.danger { background:#ef4444; border-color:#ef4444; color:#130707; font-weight:700; }
.btn.danger[disabled] { opacity:.6; cursor:not-allowed; }
.code-big { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight:800; font-size:36px; letter-spacing:2px; background:#0b0b0b; border:1px dashed #2f2f2f; border-radius:12px; padding:10px 14px; display:inline-block; }
.lobby-header { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
.lobby-actions { display:flex; gap:8px; flex-wrap:wrap; }
.players { margin-top:16px; }
.row { display:grid; grid-template-columns:1.6fr 1fr auto; align-items:center; gap:10px; padding:8px 0; border-bottom:1px dashed #2a2a2a; }
.row.head { font-weight:700; border-bottom:1px solid #2a2a2a; }
.name { font-weight:600; display:flex; align-items:center; gap:6px; }
.text-right { text-align:right; }
.host-badge { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:999px; background:#2a2230; border:1px solid #5b2ea6; font-size:12px; line-height:1; }
.lobby-launch { margin-top:16px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.lobby-hints { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.pill { display:inline-flex; align-items:center; gap:6px; font-size:12px; padding:6px 10px; border-radius:999px; border:1px solid #2b2f3a; background:#0b0e14; }
.pill.ok { border-color:#10b981; color:#10b981; }
.pill.ko { border-color:#ef4444; color:#ef4444; }
</style>
