<template>
  <div>
    <!-- ===== HEADER ===== -->
    <header v-if="ready && hasStarted && !hidePhaseActive" class="fixed-header">
      <button class="gear" @click="menuOpen = !menuOpen" aria-label="Paramètres">⚙️</button>
      <div v-if="menuOpen" class="menu">
        <button class="menu-item" @click="quit()" :disabled="leaving">Quitter la partie</button>
      </div>

      <div class="bigtime">
        {{ gameElapsedLabel }}
        <span class="total" v-if="hasFiniteTime">/ {{ gameTotalLabel }}</span>
        <span v-else>/ ∞</span>
      </div>
      <div class="progress" v-if="hasFiniteTime">
        <div class="bar" :style="{ width: Math.min(100, gameElapsedRatio * 100) + '%' }"></div>
      </div>
    </header>

    <!-- ===== PAGE ===== -->
    <main class="container" :class="{ 'with-header': ready && hasStarted && !hidePhaseActive }"
          v-if="ready">
      <div class="chips">
        <span class="chip">👤 {{ session.player?.name }}</span>
        <span class="chip" :class="isSeeker ? 'seek' : 'hide'">{{
            isSeeker ? 'Chercheur' : 'Cacheur'
          }}</span>
        <span class="chip people">👥 {{ playersCount }}</span>
      </div>

      <!-- PHASE CACHE -->
      <section v-if="hidePhaseActive || !hasStarted" class="phase">
        <template v-if="isHider">
          <h2>🕒 Temps pour se cacher</h2>
          <p class="count">{{ hideRemainingLabel }}</p>
          <p class="hint">Tu as 2 minutes pour te cacher avant que la chasse commence.</p>
        </template>
        <template v-else>
          <h2>🙈 Patiente encore</h2>
          <p class="count">{{ hideRemainingLabel }}</p>
          <p class="hint">Les cacheurs se placent. La chasse commence juste après.</p>
        </template>
      </section>

      <!-- APRES CACHE -->
      <section v-else class="card">
        <!-- Onglets (pas de "Bonus" pour les cacheurs) -->
        <div class="tabs" role="tablist">
          <button
            v-for="t in tabsToShow"
            :key="t.key"
            class="tab"
            :class="{ active: activeTab === t.key }"
            @click="setTab(t.key)"
            role="tab"
          >{{ t.label }}
          </button>
        </div>

        <div class="tab-content">
          <!-- Messages -->
          <div v-if="activeTab === 'msg'" class="pane" role="tabpanel">
            <div class="chat-list" ref="listRef" @scroll.passive="onScroll">
              <div
                v-for="m in chatMessages"
                :key="m.id"
                class="bubble"
                :class="m.mine ? 'me' : 'other'"
              >
                <div class="meta">
                  <span class="who">{{ m.mine ? 'Moi' : m.author }}</span>
                  <span class="time">{{ m.timeLabel }}</span>
                </div>

                <!-- Message système (bonus) rendu lisible -->
                <template v-if="m._system && m._sysType==='bonus_schedule'">
                  <div class="text">
                    {{ m._sysHuman }}
                  </div>
                </template>

                <!-- Image (masquées aux chercheurs) -->
                <template v-else-if="m.type === 'image'">
                  <img class="img-msg" :src="m.content" alt="Photo"/>
                  <small v-if="m.failed" class="muted">— échec d’envoi</small>
                </template>

                <!-- Texte normal -->
                <template v-else>
                  <div class="text">
                    {{ m.content }}
                    <small v-if="m.failed" class="muted">— échec</small>
                  </div>
                </template>
              </div>

              <p v-if="!chatMessages.length" class="muted">Aucun message pour l’instant.</p>
            </div>

            <form class="chat-send" @submit.prevent="sendMessage">
              <input v-model.trim="draft" type="text" placeholder="Écris un message…"/>
              <button class="btn" :disabled="!draft || sending">Envoyer</button>
            </form>
          </div>

          <!-- Images -->
          <div v-else-if="activeTab === 'img'" class="pane" role="tabpanel">
            <!-- Cacheur : caméra -->
            <div v-if="isHider" class="cam-pane">
              <template v-if="!snapDataUrl">
                <div class="cam-box">
                  <video ref="videoRef" autoplay playsinline muted class="cam-video"></video>
                </div>
                <div class="cam-actions">
                  <button class="btn" @click="takePhoto" :disabled="!camReady">Prendre la photo</button>
                  <button class="btn ghost" @click="startCamera" v-if="!camReady">Activer l’appareil photo</button>
                </div>
                <p class="muted" v-if="camError">{{ camError }}</p>
              </template>

              <template v-else>
                <div class="cam-preview">
                  <img :src="snapDataUrl" alt="Aperçu" />
                </div>
                <div class="cam-actions">
                  <button class="btn" @click="sendSnap" :disabled="sendingImg">Envoyer</button>
                  <button class="btn ghost" @click="retake" :disabled="sendingImg">Refaire</button>
                </div>
              </template>

              <canvas ref="canvasRef" class="hidden"></canvas>
            </div>

            <!-- Chercheur : dernière image -->
            <div v-else class="last-image-pane">
              <template v-if="msg.lastImage">
                <div class="last-image-box">
                  <img :src="msg.lastImage.content" alt="Dernière photo" />
                  <div class="last-meta">
                    Reçue à {{ new Date(msg.lastImage.created_at*1000).toLocaleTimeString().slice(0,8) }}
                    — par {{ msg.lastImage.author || 'Joueur' }}
                  </div>
                </div>
              </template>
              <p v-else class="muted">Aucune image reçue pour l’instant.</p>
              <div>
                <button class="btn ghost" @click="msg.fetchSince()">Actualiser</button>
              </div>
            </div>
          </div>

          <!-- Bonus (uniquement pour chercheurs) -->
          <div v-else-if="activeTab === 'bonus' && isSeeker" class="pane" role="tabpanel">
            <div class="bonus-panel">
              <div class="timer-row">
                🎁 Bonus disponibles
              </div>

              <div class="bonus-list">
                <template v-if="availableBonuses.length">
                  <button
                    v-for="b in availableBonuses"
                    :key="b.key"
                    class="chip action"
                    @click="scheduleBonusFromFront(b)"
                  >
                    {{ b.label || b.key }}
                    <small v-if="b.durationSec" class="muted"> ({{ b.durationSec }}s)</small>
                  </button>
                </template>
                <template v-else>
                  <span class="muted">Aucun bonus disponible</span>
                </template>
              </div>

              <div class="active-box" v-if="pickedBonus">
                <div class="active-title">🎯 Bonus en cours</div>
                <div class="active-info">
                  {{ pickedBonus.label || pickedBonus.key }}
                  <span class="sep">—</span>
                  reste {{ fmtMs(activeRemainingMs) }}
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>
    </main>

    <main class="container" v-else>
      <p class="muted">Chargement…</p>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import { useGameStore } from '@/stores/game'
import { useRulesStore } from '@/stores/rules'
import { useTimeStore } from '@/stores/time'
import { useMessageStore } from '@/stores/message'

/* ====== CONFIG ====== */
const HIDE_PHASE_SEC     = 120
const SYS_PREFIX         = '$hns_sys|'          // messages système ignorés dans le chat
const SYS_TYPE_SCHEDULE  = 'bonus_schedule'
const SCHEDULE_DELAY_SEC = 5

/* ====== STORES / ROUTER ====== */
const router  = useRouter()
const session = useSessionStore()
const game    = useGameStore()
const rules   = useRulesStore()
const time    = useTimeStore()
const msg     = useMessageStore()

/* ====== STATE ====== */
const ready        = ref(false)
const leaving      = ref(false)
const menuOpen     = ref(false)
const startedAtMs  = ref(null)
const maxTotalMs   = ref(0)
const playersCount = ref(0)
const nowMs        = ref(0)

/* ====== ROLES ====== */
const isHider  = computed(() => session.player?.role === 'hider')
const isSeeker = computed(() => session.player?.role === 'seeker')

/* ====== TIMERS ====== */
const hasStarted = computed(() => !!startedAtMs.value && nowMs.value >= startedAtMs.value)
const hideEndMs = computed(() => startedAtMs.value ? startedAtMs.value + HIDE_PHASE_SEC*1000 : null)
const hidePhaseActive = computed(() => hasStarted.value && hideEndMs.value && nowMs.value < hideEndMs.value)
const hideRemainingLabel = computed(() => hideEndMs.value ? fmtMs(Math.max(0, hideEndMs.value - nowMs.value)) : '—')

const hasFiniteTime   = computed(() => maxTotalMs.value > 0)
const gameElapsedMs   = ref(0)
const gameElapsedLabel= computed(() => fmtMs(gameElapsedMs.value))
const gameTotalLabel  = computed(() => fmtMs(maxTotalMs.value))
const gameElapsedRatio= computed(() => !hasFiniteTime.value || !maxTotalMs.value ? 0 : Math.min(1, gameElapsedMs.value/maxTotalMs.value))

let rafId = null
function nowServer(){ return time?.nowServerMs?.() ?? Date.now() }
function rafTick(){
  nowMs.value = nowServer()
  if (startedAtMs.value) {
    const anchor = hideEndMs.value ?? startedAtMs.value
    gameElapsedMs.value = Math.max(0, nowMs.value - anchor)
  } else gameElapsedMs.value = 0

  if (pickedBonus.value) {
    activeRemainingMs.value = Math.max(0, pickedBonus.value.endMs - nowMs.value)
    if (activeRemainingMs.value <= 0) { pickedBonus.value = null; activeTab.value = 'msg' }
  }
  rafId = requestAnimationFrame(rafTick)
}

/* ====== CHAT ====== */
const listRef    = ref(null)
const draft      = ref('')
const sending    = ref(false)
const autoscroll = ref(true)
function atBottom(el){ if(!el) return true; const slack=16; return el.scrollTop + el.clientHeight >= el.scrollHeight - slack }
function scrollToBottom(smooth=true){ nextTick(()=>{ const el=listRef.value; if(!el) return; el.scrollTo({ top: el.scrollHeight, behavior: smooth?'smooth':'auto' }) }) }
function onScroll(e){ autoscroll.value = atBottom(e?.target) }

/* ====== BONUS (depuis l’API) ====== */
const consumedLocal = ref(new Set()) // keys déjà “prises” via messages
const storageKeyConsumed = computed(() => session.game?.id ? `hns_consumed_${session.game.id}` : null)
function loadConsumed(){ try{ if(!storageKeyConsumed.value) return; const raw=localStorage.getItem(storageKeyConsumed.value); if(raw) consumedLocal.value=new Set(JSON.parse(raw)) }catch{} }
function saveConsumed(){ try{ if(!storageKeyConsumed.value) return; localStorage.setItem(storageKeyConsumed.value, JSON.stringify([...consumedLocal.value])) }catch{} }

const catalogMap = computed(() => new Map((rules.catalog||[]).map(c => [c.key, c])))
const availableBonuses = computed(() => {
  const list = (rules.bonuses||[]).filter(b => !b.start_ts) // pas encore déclenchés côté API
  return list
    .filter(b => !consumedLocal.value.has(b.key))
    .map(b => {
      const cat = catalogMap.value.get(b.key) || {}
      const dur = Number(b.override_duration_sec ?? cat.default_duration_sec ?? 0) || 0
      return { key:b.key, label:b.label || cat.label || b.key, durationSec:dur }
    })
})

/* ====== PLANIFS via messages système ====== */
const processedSys = ref(new Set())  // ids déjà traités
const pendingByKey = ref(new Map())  // key -> applyAtSec
const timersByKey  = ref(new Map())  // key -> timeoutId
const bonusFeed    = ref([])         // (facultatif)
const pickedBonus       = ref(null)  // bonus actif
const activeRemainingMs = ref(0)

function isSystem(s){ return typeof s === 'string' && s.startsWith(SYS_PREFIX) }
function parseSystem(s){
  // "$hns_sys|bonus_schedule|key=...|apply_at=...|duration=...|by=..."
  if (!isSystem(s)) return null
  const parts = s.split('|'), type = parts[1] || ''
  const kv = {}
  for (let i=2;i<parts.length;i++){ const [k,...rest]=parts[i].split('='); kv[k]=rest.join('=') }
  return { type, ...kv }
}
const labelOf = (key) => (catalogMap.value.get(key)?.label || key)

function onScheduleMessage(m, sys){
  const key = String(sys.key || '').trim()
  const applyAtSec = Number(sys.apply_at || 0)
  const durationSec = Number(sys.duration || 0)
  if (!key || !applyAtSec) return

  // masquer le bouton immédiatement
  if (!consumedLocal.value.has(key)) { consumedLocal.value.add(key); saveConsumed() }

  if (pendingByKey.value.has(key)) return
  pendingByKey.value.set(key, applyAtSec)

  // petit log (facultatif)
  const who = m.author && m.author !== '$system' ? m.author : 'Un joueur'
  const when = new Date(applyAtSec*1000).toLocaleTimeString().slice(0,8)
  bonusFeed.value.unshift({ text: `${who} a activé le bonus ${labelOf(key)} — début à ${when}` })
  if (bonusFeed.value.length > 10) bonusFeed.value.pop()

  // démarrage synchronisé
  const delayMs = Math.max(0, applyAtSec*1000 - nowServer())
  const startFn = () => {
    const endMs = applyAtSec*1000 + durationSec*1000
    pickedBonus.value = { key, label:labelOf(key), endMs, durationSec }
    activeRemainingMs.value = Math.max(0, endMs - nowServer())
    pendingByKey.value.delete(key)
    timersByKey.value.delete(key)
  }
  const tid = setTimeout(startFn, delayMs)
  timersByKey.value.set(key, tid)
  if (delayMs === 0) startFn()
}

/* Prochain bonus : countdown si planifié ; 0 si bouton dispo ; -1 sinon */
const bonusPlanReady = computed(() => isSeeker.value)
const nextBonusMs = computed(() => {
  let soonest = Infinity
  for (const [, at] of pendingByKey.value) {
    const diff = at*1000 - nowServer()
    if (diff > 0 && diff < soonest) soonest = diff
  }
  if (soonest !== Infinity) return Math.floor(soonest)
  if (availableBonuses.value.length > 0) return 0
  return -1
})

async function scheduleBonusFromFront(b){
  if (!isSeeker.value) return
  const applyAtSec = Math.floor(nowServer()/1000) + SCHEDULE_DELAY_SEC
  const payload = `${SYS_PREFIX}${SYS_TYPE_SCHEDULE}|key=${b.key}|apply_at=${applyAtSec}|duration=${b.durationSec}|by=${session.player?.id||''}`
  await msg.sendMessage(payload)
  if (!consumedLocal.value.has(b.key)) { consumedLocal.value.add(b.key); saveConsumed() }
  onScheduleMessage({ author: session.player?.name || 'Moi' }, { key:b.key, apply_at:applyAtSec, duration:b.durationSec })
}

/* ====== CHAT VISIBLE (ignore systèmes, cache les images chez les chercheurs) ====== */
const chatMessages = computed(() => {
  const base = (msg.messages || []).filter(m => !isSystem(m.content))
  return isSeeker.value ? base.filter(m => m.type !== 'image') : base
})
watch(() => msg.messages?.length || 0, () => {
  for (const m of (msg.messages || [])) {
    if (processedSys.value.has(m.id)) continue
    const sys = parseSystem(m.content)
    if (sys?.type === SYS_TYPE_SCHEDULE) { processedSys.value.add(m.id); onScheduleMessage(m, sys) }
  }
  if (autoscroll.value) scrollToBottom(true)
})

async function sendMessage(){
  if (!draft.value) return
  try { sending.value = true; await msg.sendMessage(draft.value); draft.value=''; scrollToBottom(true) }
  finally { sending.value = false }
}

/* ====== ONGLETS ====== */
const tabs = [
  { key:'msg',   label:'Messages' },
  { key:'img',   label:'Images'   },
  { key:'bonus', label:'Bonus'    },
]
const tabsToShow = computed(() => isSeeker.value ? tabs : tabs.filter(t => t.key !== 'bonus'))
const activeTab  = ref('msg')
function setTab(k){ activeTab.value = k }

/* ====== CAMÉRA (chercheur) ====== */
const videoRef  = ref(null)
const canvasRef = ref(null)
const camStream = ref(null)
const camReady  = ref(false)
const camError  = ref('')
const snapDataUrl = ref('')
const sendingImg  = ref(false)

async function startCamera(){
  try{
    camError.value=''
    if (camStream.value) return (camReady.value=true)
    const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:'environment' } }, audio:false })
    camStream.value = stream
    const v = videoRef.value; if (v){ v.srcObject = stream; await v.play() }
    camReady.value = true
  }catch{ camError.value='Caméra indisponible. Autorise l’accès ou change de navigateur.'; camReady.value=false }
}
function stopCamera(){ try{ camStream.value?.getTracks()?.forEach(t=>t.stop()) }catch{}; camStream.value=null; camReady.value=false }
function takePhoto(){
  const v=videoRef.value,c=canvasRef.value; if(!v||!c) return
  const w=v.videoWidth||1280,h=v.videoHeight||720; c.width=w;c.height=h
  const ctx=c.getContext('2d'); ctx.drawImage(v,0,0,w,h)
  snapDataUrl.value = c.toDataURL('image/jpeg',0.85)
}
async function sendSnap(){
  if (!snapDataUrl.value) return
  try{
    sendingImg.value=true
    if (typeof msg.sendImage === 'function') await msg.sendImage(snapDataUrl.value)
    else await msg.sendMessage('[image]\n'+snapDataUrl.value) // fallback
    snapDataUrl.value=''
  }finally{ sendingImg.value=false }
}
function retake(){ snapDataUrl.value='' }
watch(activeTab, (k)=>{ if (k==='img' && isSeeker.value) startCamera(); else stopCamera() })
onBeforeUnmount(stopCamera)

/* ====== MESSAGES POLLING ====== */
const msgPollId = ref(null)
async function startMessageLoop(){
  try{
    if (typeof msg.initPolling === 'function') {
      await msg.initPolling()
    } else if (typeof msg.fetchInitial === 'function') {
      await msg.fetchInitial()
      msgPollId.value = setInterval(()=> msg.fetchSince?.(), 1500)
    }
  }catch{}
}
function stopMessageLoop(){
  try{ msg.stopPolling?.() }catch{}
  if (msgPollId.value){ clearInterval(msgPollId.value); msgPollId.value=null }
}

/* ====== QUIT ROBUSTE ====== */
const goingHome = ref(false)

function cleanup() {
  try { if (rafId) cancelAnimationFrame(rafId) } catch {}
  try { if (pollPlayersId.value) clearInterval(pollPlayersId.value) } catch {}
  stopMessageLoop()
  stopCamera()
  for (const t of timersByKey.value.values()) clearTimeout(t)
  timersByKey.value.clear()
}

function clearLocalGame() {
  try {
    if (typeof session.setGame === 'function') session.setGame(null)
    else session.game = null
  } catch {}
}

async function goLobbyOnce(reason = '') {
  if (goingHome.value) return
  goingHome.value = true
  menuOpen.value = false

  try {
    if (typeof router.hasRoute === 'function' && router.hasRoute('home')) {
      await router.replace({ name:'home' })
    } else {
      await router.replace('/')
    }
  } catch {}

  setTimeout(() => {
    const r = router.currentRoute?.value
    const onHome = r?.name === 'home' || r?.path === '/'
    if (!onHome) window.location.href = '/'
    if (reason) alert(reason)
  }, 0)
}

async function quit({ silent = true, keepAuth = true, reason = '' } = {}) {
  if (leaving.value) return
  leaving.value = true

  if (!silent && !confirm('Quitter la partie ?')) { leaving.value = false; return }

  try {
    await Promise.race([
      game.removePlayer?.(),                       // ne bloque pas
      new Promise(res => setTimeout(res, 1200)),
    ])
  } catch {}

  cleanup()
  clearLocalGame()
  if (!keepAuth) session.clearAuth?.()
  await goLobbyOnce(reason)
  leaving.value = false
}

/* ====== POLL PLAYERS ====== */
const pollPlayersId = ref(null)
async function refreshPlayers(){
  if (leaving.value || goingHome.value) return
  try {
    const { players } = await game.getPlayers()
    playersCount.value = players?.length || 0
    if (playersCount.value < 3) {
      await quit({ silent:true, keepAuth:true, reason:'Partie terminée (moins de 3 joueurs).' })
    }
  } catch {
    await quit({ silent:true, keepAuth:true })
  }
}

/* ====== INIT ====== */
function ensureInGame(){
  session.loadFromStorage?.()
  return !!(session.isAuthenticated && session.game?.id)
}

async function init(){
  ready.value = false

  if (!ensureInGame()) {
    await goLobbyOnce()
    return
  }

  // 1) Game
  try {
    const { game: g } = await game.getGame({ id: session.game.id })
    if (!g?.id) throw new Error('no_game')
    startedAtMs.value = g.started_at ? Number(g.started_at)*1000 : null
    maxTotalMs.value  = g.max_duration_sec ? Number(g.max_duration_sec)*1000 : 0
    nowMs.value = nowServer()
  } catch {
    await goLobbyOnce()
    return
  }

  // 2) Règles / catalog (ne bloquent pas l’affichage)
  try { await rules.fetchCatalog?.() } catch {}
  try { await rules.fetchRules?.() } catch {}
  loadConsumed()

  // 3) Timers & polling (ne bloquent pas l’affichage)
  try {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(rafTick)
  } catch {}

  try {
    if (pollPlayersId.value) clearInterval(pollPlayersId.value)
    await refreshPlayers()
    pollPlayersId.value = setInterval(refreshPlayers, 2000)
  } catch {}

  try { await startMessageLoop() } catch {}
  nextTick(()=> scrollToBottom(false))

  // 4) Afficher quoi qu’il arrive
  ready.value = true
}

/* ====== UTILS ====== */
function pad(n){ return n<10 ? '0'+n : ''+n }
function fmtMs(ms){ const t=Math.max(0,Math.floor(ms/1000)), m=Math.floor(t/60), s=t%60; return `${pad(m)}:${pad(s)}` }

/* ====== LIFECYCLE ====== */
onMounted(init)
onBeforeUnmount(cleanup)
</script>


<style scoped>
/* Header & layout */
.fixed-header {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 50;
  display: grid;
  gap: 8px;
  place-items: center;
  padding: 10px 12px;
  background: rgba(0, 0, 0, .7);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid rgba(255, 255, 255, .08);
}

.bigtime {
  font-weight: 900;
  color: #fff;
  line-height: 1;
  padding: 10px 18px;
  border-radius: 16px;
  background: rgba(0, 0, 0, .35);
  border: 1px solid rgba(255, 255, 255, .12);
  font-size: clamp(28px, 5.5vw, 56px);
}

.bigtime .total {
  opacity: .85;
  font-weight: 800;
}

.progress {
  width: min(880px, 96vw);
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, .12);
  overflow: hidden;
}

.progress .bar {
  height: 100%;
  background: #10b981;
  transition: width .2s linear;
}

.gear {
  position: absolute;
  left: 12px;
  top: 10px;
  font-size: 18px;
  background: transparent;
  border: none;
  color: #ddd;
  cursor: pointer;
}

.menu {
  position: absolute;
  left: 12px;
  top: 42px;
  background: #0f1115;
  border: 1px solid #2b2f3a;
  border-radius: 10px;
  padding: 6px;
  z-index: 51;
}

.menu-item {
  display: block;
  width: 180px;
  padding: 8px 10px;
  text-align: left;
  background: #12161d;
  color: #eee;
  border: 1px solid #2a2f3a;
  border-radius: 8px;
  cursor: pointer;
}

.menu-item:hover {
  background: #1a2130;
}

.container.with-header {
  padding-top: 120px;
}

.container {
  max-width: 90vw;
  margin: 24px auto;
  padding: 16px;
}

.muted {
  opacity: .7;
}

/* Chips */
.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0 0 12px;
  align-items: center;
}

.chip {
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid #2b2f3a;
  background: #0b0e14;
  color: #eee;
}

.chip.seek {
  background: #1a2d3e;
  color: #8fd3ff;
  border-color: #29465f;
}

.chip.hide {
  background: #132d20;
  color: #7ff7c8;
  border-color: #255442;
}

.chip.people {
  background: #18131f;
  border-color: #3b2a55;
}

/* Phase */
.phase {
  border: 1px dashed #2a2a2a;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  background: #0f1115;
}

.count {
  font-size: 42px;
  font-weight: 900;
  margin: 6px 0 2px;
}

.hint {
  opacity: .8;
}

/* Card & tabs */
.card {
  border: 1px solid #242424;
  background: #0f1115;
  border-radius: 12px;
  padding: 12px;
}

.tabs {
  display: flex;
  gap: 8px;
  width: 100%;
  border: 1px solid #2b2f3a;
  background: #0b0e14;
  border-radius: 10px;
  padding: 6px;
}

.tab {
  flex: 1 0 0;
  text-align: center;
  padding: 10px 12px;
  border-radius: 8px;
  background: transparent;
  color: #ddd;
  border: none;
  cursor: pointer;
  font-weight: 700;
}

.tab.active {
  background: #10b981;
  color: #112015;
}

.tab.hidden {
  display: none;
}

.tab-content {
  margin-top: 12px;
}

.pane {
  min-height: 50vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Chat */
.chat-list {
  flex: 1;
  min-height: 240px;
  max-height: 100%;
  overflow: auto;
  padding: 8px;
  border: 1px solid #232323;
  border-radius: 10px;
  background: #0b0e14;
}

.bubble {
  max-width: 80%;
  padding: 8px 10px;
  border-radius: 12px;
  margin: 8px 0;
}

.bubble.me {
  margin-left: auto;
  background: #10281f;
  border: 1px solid #1f4c38;
}

.bubble.other {
  margin-right: auto;
  background: #10161f;
  border: 1px solid #273042;
}

.meta {
  font-size: 12px;
  opacity: .8;
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}

.text {
  white-space: pre-wrap;
  word-break: break-word;
}

.img-msg {
  max-width: min(360px, 70vw);
  border-radius: 10px;
  display: block;
}

/* Camera */
.cam-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cam-box {
  width: 100%;
  aspect-ratio: 3/4;
  background: #0b0e14;
  border: 1px solid #232323;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cam-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cam-preview img {
  width: 100%;
  border-radius: 12px;
}

.cam-actions {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid #29465f;
  background: #1a2d3e;
  color: #cfe9fb;
  font-weight: 700;
  cursor: pointer;
}

.btn.ghost {
  background: transparent;
  color: #ddd;
  border-color: #3a3f4a;
}

.btn:disabled {
  opacity: .5;
  cursor: not-allowed;
}

.hidden {
  display: none;
}

/* Dernière image (cacheur) */
.last-image-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.last-image-box {
  border: 1px solid #232323;
  background: #0b0e14;
  border-radius: 12px;
  padding: 10px;
}

.last-image-box img {
  width: 100%;
  border-radius: 10px;
}

.last-meta {
  margin-top: 6px;
  font-size: 12px;
  opacity: .8;
}

/* Bonus */
.bonus-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.timer-row {
  font-weight: 700;
}

.bonus-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.chip.action {
  cursor: pointer;
}

.active-box {
  border: 1px solid #232323;
  background: #0b0e14;
  border-radius: 10px;
  padding: 10px 12px;
}

.active-title {
  font-weight: 800;
  margin-bottom: 4px;
}

.active-info {
  display: flex;
  gap: 6px;
  align-items: center;
}

.sep {
  opacity: .6;
}
</style>
