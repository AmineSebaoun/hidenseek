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
        <button class="btn" @click="$emit('open-rules')">⚙️ Règles</button>
        <button class="btn ghost" @click="refreshPlayers" :disabled="savingRoles">Rafraîchir</button>
      </div>
    </div>

    <div class="players">
      <div class="row head">
        <div>Joueur</div>
        <div>Rôle</div>
        <div>Actions</div>
      </div>

      <div v-for="(p,i) in players" :key="p.id" class="row">
        <div class="name">
          <span v-if="i===0">👑</span> {{ p.name }}
          <span class="tiny-muted" v-if="p.id===session.player?.id">(moi)</span>
        </div>
        <div>
          <select :value="p.role" @change="onChangeRole(p, $event.target.value)" :disabled="savingRoles || !isHost">
            <option value="seeker">Chercheur</option>
            <option value="hider">Cacheur</option>
          </select>
        </div>
        <div>
          <button class="btn danger tiny" v-if="isHost && p.id!==session.player?.id" @click="kick(p)">Retirer</button>
        </div>
      </div>

      <p v-if="players.length===0" class="muted">En attente de joueurs…</p>
    </div>

    <div class="lobby-launch">
      <button
        class="btn primary"
        :disabled="!isHost || !canLaunch || isScheduled || loadingLaunch"
        @click="planStart"
        :title="launchTooltip"
      >
        <span v-if="!loadingLaunch">Lancer la partie</span>
        <span v-else>…</span>
      </button>

      <button class="btn danger" :disabled="quitting" @click="quit">Quitter la partie</button>

      <div class="lobby-hints">
        <span :class="['pill', hasMinPlayers ? 'ok' : 'ko']">Joueurs: {{ players.length }} / 3</span>
        <span :class="['pill', rolesOk ? 'ok' : 'ko']">Rôles: {{ rolesOk ? 'OK' : 'Manquants' }}</span>
      </div>

      <p v-if="isScheduled && !showCountdown" class="muted">
        ⏳ La partie est sur le point de commencer…
      </p>
    </div>

    <transition name="fade">
      <div v-if="showCountdown" class="countdown-overlay">
        <div class="count">{{ countdownLabel }}</div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import { useGameStore } from '@/stores/game'
import { useTimeStore } from '@/stores/time'

/** Fenêtre d’affichage du 3-2-1 (3s) */
const BASE_COUNTDOWN_SEC   = 3
const COUNTDOWN_WINDOW_MS  = BASE_COUNTDOWN_SEC * 1000
/** Tampon de sécurité demandé (+2s) */
const START_BUFFER_SEC     = 2                               // ⬅︎
const SCHEDULE_SECONDS     = BASE_COUNTDOWN_SEC + START_BUFFER_SEC // ⬅︎

const emit = defineEmits(['open-rules'])
const router = useRouter()
const session = useSessionStore()
const game = useGameStore()
const time = useTimeStore()

const players = ref([])
const savingRoles = ref(false)
const quitting = ref(false)
const loadingLaunch = ref(false)

const scheduledStartMs = ref(null)
const pollPlayersId = ref(null)
const pollGameId = ref(null)

function copy(t){ if(t){ navigator.clipboard?.writeText(t).catch(()=>{}) } }

const isHost = computed(() => players.value[0]?.id === session.player?.id)
const hasMinPlayers = computed(() => players.value.length >= 3)
const rolesOk = computed(() => {
  let s=0,h=0
  for (const p of players.value){ if(p.role==='seeker') s++; if(p.role==='hider') h++; }
  return s>=1 && h>=1
})
const canLaunch = computed(() => hasMinPlayers.value && rolesOk.value)
const launchTooltip = computed(() => {
  if (!isHost.value) return 'Seul le chef peut lancer.'
  if (!hasMinPlayers.value) return 'Minimum 3 joueurs requis.'
  if (!rolesOk.value) return 'Il faut au moins 1 Chercheur et 1 Cacheur.'
  return 'Prêt à programmer le départ.'
})
const isScheduled = computed(() => !!scheduledStartMs.value)

async function refreshPlayers(){ try{ players.value = (await game.getPlayers()).players || [] }catch{} }
async function refreshGame(){
  try{
    const g = (await game.getGame({ id: session.game?.id })).game || {}
    scheduledStartMs.value = g.scheduled_start_ts ? Number(g.scheduled_start_ts)*1000 : null
    ensureCountdownLoopRunning()
    if (g.state === 'active') router.replace({ name:'game' })
  }catch{}
}
function startPolling(){
  stopPolling()
  refreshPlayers(); refreshGame()
  pollPlayersId.value = setInterval(refreshPlayers, 2500)
  pollGameId.value    = setInterval(refreshGame,   1000)
}
function stopPolling(){
  if (pollPlayersId.value){ clearInterval(pollPlayersId.value); pollPlayersId.value=null }
  if (pollGameId.value)   { clearInterval(pollGameId.value);    pollGameId.value=null }
}

async function onChangeRole(p, role){
  try{ if(!isHost.value) return; savingRoles.value=true; await game.setRole(p.id, role); await refreshPlayers() }
  finally{ savingRoles.value=false }
}
async function randomizeRoles(){
  if(!players.value.length || !isHost.value) return
  savingRoles.value=true
  try{
    const sh=[...players.value].sort(()=>Math.random()-0.5)
    const half=Math.floor(sh.length/2)
    const seekers=new Set(sh.slice(0,half).map(p=>p.id))
    for(const p of sh){ const target=seekers.has(p.id)?'seeker':'hider'; if(p.role!==target) await game.setRole(p.id,target) }
    await refreshPlayers()
  } finally { savingRoles.value=false }
}
async function kick(p){
  if(!isHost.value || p.id===session.player?.id) return
  if(!confirm(`Retirer ${p.name} ?`)) return
  try{ await game.removePlayer(p.id); await refreshPlayers() }catch{}
}

/** ➜ Planifie à 3s + 2s tampon = 5s */
async function planStart(){
  if(!isHost.value || !canLaunch.value || isScheduled.value) return
  loadingLaunch.value=true
  try{
    const r = await game.scheduleStart(SCHEDULE_SECONDS)     // ⬅︎
    scheduledStartMs.value = Number(r.scheduled_start_ts)*1000
    ensureCountdownLoopRunning(true)
  }catch(e){
    alert(e?.response?.data?.error || e?.message || 'Impossible de programmer le départ')
  } finally { loadingLaunch.value=false }
}

/* ---------- overlay 3-2-1 ---------- */
const showCountdown = ref(false)
const countdownMs   = ref(0)
let rafId = null

function ensureCountdownLoopRunning(force=false){
  if(!scheduledStartMs.value){ stopCountdownLoop(); return }
  if(force && !rafId) startCountdownLoop()
  if(!rafId && time.nowServerMs() >= scheduledStartMs.value - COUNTDOWN_WINDOW_MS){
    startCountdownLoop()
  }
}
function startCountdownLoop(){ if(rafId) return; tick() }
function stopCountdownLoop(){ if(rafId) cancelAnimationFrame(rafId); rafId=null; showCountdown.value=false }
function tick(){
  if(!scheduledStartMs.value){ stopCountdownLoop(); return }
  const now = time.nowServerMs()
  const rem = Math.max(0, scheduledStartMs.value - now)
  countdownMs.value = rem
  showCountdown.value = rem > 0 && rem <= COUNTDOWN_WINDOW_MS
  if(rem<=0){ stopCountdownLoop(); return }
  rafId = requestAnimationFrame(tick)
}
const countdownLabel = computed(()=>{
  const s = Math.ceil(countdownMs.value/1000)
  return Math.min(3, Math.max(1, s))
})

async function quit(){
  if(quitting.value) return
  if(!confirm('Quitter la partie ?')) return
  quitting.value=true
  try{ await game.removePlayer() }catch{}
  finally{
    session.clearAuth()
    stopPolling(); stopCountdownLoop()
    router.replace({ name:'home' })
    quitting.value=false
  }
}

onMounted(()=> startPolling())
onBeforeUnmount(()=>{ stopPolling(); stopCountdownLoop() })
</script>

<style scoped>
.panel { margin-top:12px; padding:16px; border:1px solid #2f2f2f; border-radius:10px; background:#111; }
.muted { opacity:.7; font-size:12px; }
.tiny-muted { opacity:.6; font-size:12px; }
.lobby-header { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
.lobby-actions { display:flex; gap:8px; flex-wrap:wrap; }
.code-big { font-family: ui-monospace, Menlo, monospace; font-weight:800; font-size:36px; letter-spacing:2px; background:#0b0b0b; border:1px dashed #2f2f2f; border-radius:12px; padding:10px 14px; display:inline-block; }

.players { margin-top:16px; }
.row { display:grid; grid-template-columns: 1.6fr 1fr auto; align-items:center; gap:10px; padding:8px 0; border-bottom:1px dashed #2a2a2a; }
.row.head { font-weight:700; border-bottom:1px solid #2a2a2a; }
.name { font-weight:600; }

.btn { padding:10px 14px; border-radius:8px; border:1px solid #3b3b3b; background:#1b1b1b; color:#eee; cursor:pointer; }
.btn.primary { background:#10b981; border-color:#10b981; color:#07130e; font-weight:700; }
.btn.danger { background:#ef4444; border-color:#ef4444; color:#130707; font-weight:700; }
.btn.ghost { background:transparent; }
.btn.tiny { padding:6px 10px; }

.lobby-launch { margin-top:16px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.lobby-hints { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.pill { display:inline-flex; align-items:center; gap:6px; font-size:12px; padding:6px 10px; border-radius:999px; border:1px solid #2b2f3a; background:#0b0e14; }
.pill.ok { border-color:#10b981; color:#10b981; }
.pill.ko { border-color:#ef4444; color:#ef4444; }

/* Overlay 3-2-1 */
.countdown-overlay {
  position: fixed; inset: 0; display: grid; place-items: center;
  background: rgba(0,0,0,.55); backdrop-filter: blur(2px); z-index: 9998;
}
.count { font-size: 20vmin; font-weight: 900; line-height: 1; color: #fff; text-shadow: 0 6px 24px rgba(0,0,0,.6); }
.fade-enter-active, .fade-leave-active { transition: opacity .2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
