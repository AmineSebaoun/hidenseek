<>
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
        <!-- Onglets (badge rouge sur Images) -->
        <div class="tabs" role="tablist">
          <button v-for="t in tabsToShow" :key="t.key" class="tab"
                  :class="{ active: activeTab === t.key }" @click="setTab(t.key)" role="tab">
            <span>{{ t.label }}</span>
            <span v-if="t.key==='img' && isSeeker && unreadImgCount>0" class="badge"
                  :aria-label="`${unreadImgCount} nouvelle(s) image(s)`">{{ unreadImgCount }}</span>
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
                :class="m._system ? 'sys' : (m.mine ? 'me' : 'other')"
              >
                <!-- Bulle système centrée -->
                <template v-if="m._system && m._sysType==='bonus_schedule'">
                  <div class="sys-bubble">{{ m._sysHuman }}</div>
                </template>

                <!-- Messages normaux -->
                <template v-else>
                  <div class="meta">
                    <span class="who">{{ m.mine ? 'Moi' : m.author }}</span>
                    <span class="time">{{ m.timeLabel }}</span>
                  </div>

                  <!-- Image (masquées aux chercheurs via chatMessages) -->
                  <template v-if="m.type === 'image'">
                    <img class="img-msg" :src="m.content" alt="Photo" />
                    <small v-if="m.failed" class="muted">— échec d’envoi</small>
                  </template>

                  <!-- Texte -->
                  <template v-else>
                    <div class="text">
                      {{ m.content }}
                      <small v-if="m.failed" class="muted">— échec</small>
                    </div>
                  </template>
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
                  <button class="btn" @click="takePhoto" :disabled="!camReady">Prendre la photo
                  </button>
                  <button class="btn ghost" @click="startCamera" v-if="!camReady">Activer l’appareil
                    photo
                  </button>
                </div>
                <p class="muted" v-if="camError">{{ camError }}</p>
              </template>

              <template v-else>
                <div class="cam-preview">
                  <img :src="snapDataUrl" alt="Aperçu"/>
                </div>
                <div class="cam-actions">
                  <button class="btn" @click="sendSnap" :disabled="sendingImg">Envoyer</button>
                  <button class="btn ghost" @click="retake" :disabled="sendingImg">Refaire</button>
                </div>
              </template>

              <canvas ref="canvasRef" class="hidden"></canvas>
            </div>

            <!-- Chercheur : dernière image + historique -->
            <div v-else class="last-image-pane">
              <template v-if="lastImage">
                <div class="last-image-box">
                  <img :src="lastImage.content" alt="Dernière photo"/>
                  <div class="last-meta">
                    Reçue à
                    {{ new Date(lastImage.created_at * 1000).toLocaleTimeString().slice(0, 8) }}
                    — par {{ lastImage.author || 'Joueur' }}
                  </div>
                </div>
              </template>
              <p v-else class="muted">Aucune image reçue pour l’instant.</p>
              <div class="img-actions">
                <button class="btn" @click="openHistory">Historique des photos</button>
                <button class="btn ghost" @click="msg.fetchSince()">Actualiser</button>
              </div>

              <!-- Overlay + Bottom Sheet (Historique) -->
              <div class="overlay" v-if="historyOpen" @click="closeHistory"
                   aria-hidden="true"></div>
              <div class="sheet" :class="{open: historyOpen}"
                   @touchstart.passive="onSheetStart"
                   @touchmove.prevent="onSheetMove"
                   @touchend="onSheetEnd">
                <div class="sheet-grabber"></div>
                <div class="sheet-head">
                  <div>Historique des photos ({{ imageMsgs.length }})</div>
                  <button class="btn ghost" @click="closeHistory">Fermer</button>
                </div>
                <div class="sheet-list">
                  <div v-for="im in imageMsgs" :key="im.id" class="sheet-item"
                       @click="previewImage(im)"
                       :title="(im.author||'Joueur') + ' • ' + new Date(im.created_at*1000).toLocaleTimeString().slice(0,8)">
                    <img :src="im.content" alt="miniature"/>
                    <div class="sheet-meta">
                      <div class="sheet-line">{{ im.author || 'Joueur' }}</div>
                      <div class="sheet-line small">
                        {{ new Date(im.created_at * 1000).toLocaleTimeString().slice(0, 8) }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Bonus (uniquement pour chercheurs) -->
          <div v-else-if="activeTab === 'bonus' && isSeeker" class="pane" role="tabpanel">
            <div class="bonus-panel">

              <!-- Affichage minimal quand un bonus est actif -->
              <template v-if="pickedBonus">
                <div class="active-box">
                  <div class="active-title">🎯 Bonus en cours</div>
                  <div class="active-info">
                    {{ pickedBonus.label || pickedBonus.key }}
                    <span class="sep">—</span>
                    reste {{ fmtMs(activeRemainingMs) }}
                  </div>
                </div>
              </template>

              <!-- Sinon : en-tête + liste -->
              <template v-else>
                <div class="timer-row">
                  🎁 Bonus disponibles
                  <span v-if="nextBonusMs > 0" class="countdown">{{ nextBonusLabel }} — {{ fmtMs(nextBonusMs) }}</span>
                </div>

                <div class="bonus-list">
                  <button
                    v-for="b in availableBonuses"
                    :key="b.uid"
                    class="chip action"
                    @click="scheduleBonusFromFront(b)"
                  >
                    {{ b.label }} <small v-if="b.durationSec" class="muted"> ({{
                      b.durationSec
                    }}s)</small>
                  </button>

                  <span v-if="!availableBonuses.length && nextBonusMs<=0" class="muted">— aucun bonus disponible</span>
                </div>
              </template>
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
  import {ref, computed, onMounted, onBeforeUnmount, nextTick, watch} from 'vue'
  import {useRouter} from 'vue-router'
  import {useSessionStore} from '@/stores/session'
  import {useGameStore} from '@/stores/game'
  import {useRulesStore} from '@/stores/rules'
  import {useTimeStore} from '@/stores/time'
  import {useMessageStore} from '@/stores/message'

  /* =========================
     CONFIG / HELPERS
     ========================= */
  const HIDE_PHASE_SEC = 10
  const SYS_PREFIX = '$hns_sys|'
  const SYS_TYPE_SCHEDULE = 'bonus_schedule'
  const SCHEDULE_DELAY_SEC = 3

  const router = useRouter()
  const session = useSessionStore()
  const game = useGameStore()
  const rules = useRulesStore()
  const time = useTimeStore()
  const msg = useMessageStore()

  /* =========================
     ETAT GLOBAL
     ========================= */
  const ready = ref(false)
  const leaving = ref(false)
  const menuOpen = ref(false)
  const startedAtMs = ref(null)
  const maxTotalMs = ref(0)
  const playersCount = ref(0)
  const nowMs = ref(0)

  /* Rôles */
  const isHider = computed(() => session.player?.role === 'hider')
  const isSeeker = computed(() => session.player?.role === 'seeker')

  /* Onglets */
  const tabs = [
    {key: 'msg', label: 'Messages'},
    {key: 'img', label: 'Images'},
    {key: 'bonus', label: 'Bonus'},
  ]
  const tabsToShow = computed(() => isSeeker.value ? tabs : tabs.filter(t => t.key !== 'bonus'))
  const activeTab = ref('msg')

  function setTab(k) {
    activeTab.value = k
  }

  /* Timers partie */
  const hasStarted = computed(() => !!startedAtMs.value && nowMs.value >= startedAtMs.value)
  const hideEndMs = computed(() => startedAtMs.value ? startedAtMs.value + HIDE_PHASE_SEC * 1000 : null)
  const hidePhaseActive = computed(() => hasStarted.value && hideEndMs.value && nowMs.value < hideEndMs.value)
  const hideRemainingLabel = computed(() => hideEndMs.value ? fmtMs(Math.max(0, hideEndMs.value - nowMs.value)) : '—')

  const hasFiniteTime = computed(() => maxTotalMs.value > 0)
  const gameElapsedMs = ref(0)
  const gameElapsedLabel = computed(() => fmtMs(gameElapsedMs.value))
  const gameTotalLabel = computed(() => fmtMs(maxTotalMs.value))
  const gameElapsedRatio = computed(() => !hasFiniteTime.value || !maxTotalMs.value ? 0 : Math.min(1, gameElapsedMs.value / maxTotalMs.value))
  const nowSecReactive = computed(() => Math.floor(nowMs.value / 1000))

  let rafId = null

  function nowServer() {
    return time?.nowServerMs?.() ?? Date.now()
  }

  function rafTick() {
    nowMs.value = nowServer()
    if (startedAtMs.value) {
      const anchor = hideEndMs.value ?? startedAtMs.value
      gameElapsedMs.value = Math.max(0, nowMs.value - anchor)
    } else gameElapsedMs.value = 0

    if (pickedBonus.value) {
      activeRemainingMs.value = Math.max(0, pickedBonus.value.endMs - nowMs.value)
      if (activeRemainingMs.value <= 0) {
        pickedBonus.value = null;
        activeTab.value = 'msg'
      }
    }
    rafId = requestAnimationFrame(rafTick)
  }

  /* =========================
     CHAT (UI)
     ========================= */
  const listRef = ref(null)
  const draft = ref('')
  const sending = ref(false)
  const autoscroll = ref(true)

  function atBottom(el) {
    if (!el) return true;
    const slack = 16;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - slack
  }

  function scrollToBottom(smooth = true) {
    nextTick(() => {
      const el = listRef.value;
      if (!el) return;
      el.scrollTo({top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto'})
    })
  }

  function onScroll(e) {
    autoscroll.value = atBottom(e?.target)
  }

  function isSystem(s) {
    return typeof s === 'string' && s.startsWith(SYS_PREFIX)
  }

  function parseSystem(s) {
    if (!isSystem(s)) return null
    const parts = s.split('|'), type = parts[1] || ''
    const kv = {}
    for (let i = 2; i < parts.length; i++) {
      const [k, ...rest] = parts[i].split('=');
      kv[k] = rest.join('=')
    }
    return {type, ...kv} // { type:'bonus_schedule', uid, key, apply_at, duration, by }
  }

  function humanScheduleText(sys){
    const label = labelOf(String(sys.key || ''))
    const dur = Number(sys.duration || 0) || 0
    return dur > 0
      ? `Les chasseurs ont activé le bonus ${label} pendant ${dur} secondes.`
      : `Les chasseurs ont activé le bonus ${label}.`
  }

  const chatMessages = computed(() => {
    const out = []
    const list = msg.messages || []

    for (const m of list) {
      const sys = parseSystem(m.content)

      // Bonus planifié → bulle système uniquement pour les cacheurs
      if (sys?.type === SYS_TYPE_SCHEDULE) {
        if (isHider.value) {
          out.push({
            id: `sys-${m.id}`,
            _system: true,
            _sysType: SYS_TYPE_SCHEDULE,
            _sysHuman: humanScheduleText(sys),
          })
        }
        continue // on n’affiche jamais la ligne brute
      }

      // Filtrage images côté chercheur
      if (isSeeker.value && m.type === 'image') continue

      out.push(m)
    }

    return out
  })

  async function sendMessage() {
    if (!draft.value) return
    try {
      sending.value = true;
      await msg.sendMessage(draft.value);
      draft.value = '';
      scrollToBottom(true)
    } finally {
      sending.value = false
    }
  }

  /* =========================
     IMAGES (badge + historique)
     ========================= */
  const imageMsgs = computed(() =>
    (msg.messages || []).filter(m => m.type === 'image').sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
  )
  const lastImage = computed(() => msg.lastImage || (imageMsgs.value.length ? imageMsgs.value[imageMsgs.value.length - 1] : null))

  const storageKeySeenImg = computed(() =>
    (session.game?.id && session.player?.id) ? `hns_seenimg_${session.game.id}_${session.player.id}` : null
  )
  const lastSeenImageTs = ref(0)

  function loadSeen() {
    try {
      const k = storageKeySeenImg.value;
      if (!k) return;
      const raw = localStorage.getItem(k);
      lastSeenImageTs.value = raw ? Number(raw) || 0 : 0
    } catch {
    }
  }

  function saveSeen() {
    try {
      const k = storageKeySeenImg.value;
      if (!k) return;
      localStorage.setItem(k, String(lastSeenImageTs.value))
    } catch {
    }
  }

  const unreadImgCount = computed(() => imageMsgs.value.filter(im => (im.created_at || 0) > lastSeenImageTs.value).length)

  function markImagesSeen() {
    const ts = lastImage.value?.created_at || 0;
    if (ts > 0) {
      lastSeenImageTs.value = ts;
      saveSeen()
    }
  }

  watch([() => activeTab.value, () => imageMsgs.value.length, () => isSeeker.value], () => {
    if (activeTab.value === 'img' && isSeeker.value) markImagesSeen()
  })

  /* Historique bottom-sheet */
  const historyOpen = ref(false)
  let startY = 0, currentY = 0, dragging = false

  function openHistory() {
    historyOpen.value = true;
    markImagesSeen();
    window.addEventListener('keydown', onKeyDown)
  }

  function closeHistory() {
    historyOpen.value = false;
    window.removeEventListener('keydown', onKeyDown)
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') closeHistory()
  }

  function onSheetStart(e) {
    dragging = true;
    startY = e.touches?.[0]?.clientY || 0;
    currentY = startY
  }

  function onSheetMove(e) {
    if (!dragging) return;
    currentY = e.touches?.[0]?.clientY || currentY;
    const dy = currentY - startY;
    const el = document.querySelector('.sheet');
    if (el) {
      el.style.setProperty('--dragY', Math.max(0, dy) + 'px')
    }
  }

  function onSheetEnd() {
    if (!dragging) return;
    dragging = false;
    const dy = currentY - startY;
    const el = document.querySelector('.sheet');
    if (el) {
      el.style.removeProperty('--dragY')
    }
    if (dy > 120) closeHistory()
  }

  function previewImage(im) {
    const box = document.querySelector('.last-image-box img');
    if (box) box.src = im.content
  }

  /* =========================
     CAMÉRA (cacheur)
     ========================= */
  const videoRef = ref(null)
  const canvasRef = ref(null)
  const camStream = ref(null)
  const camReady = ref(false)
  const camError = ref('')
  const snapDataUrl = ref('')
  const sendingImg = ref(false)

  async function startCamera() {
    try {
      camError.value = ''
      if (camStream.value) return (camReady.value = true)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: {ideal: 'environment'}},
        audio: false
      })
      camStream.value = stream
      const v = videoRef.value;
      if (v) {
        v.srcObject = stream;
        await v.play()
      }
      camReady.value = true
    } catch {
      camError.value = 'Caméra indisponible. Autorise l’accès ou change de navigateur.';
      camReady.value = false
    }
  }

  function stopCamera() {
    try {
      camStream.value?.getTracks()?.forEach(t => t.stop())
    } catch {
    }
    ;camStream.value = null;
    camReady.value = false
  }

  function takePhoto() {
    const v = videoRef.value, c = canvasRef.value;
    if (!v || !c) return
    const w = v.videoWidth || 1280, h = v.videoHeight || 720;
    c.width = w;
    c.height = h
    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0, w, h)
    snapDataUrl.value = c.toDataURL('image/jpeg', 0.85)
  }

  async function sendSnap() {
    if (!snapDataUrl.value) return
    try {
      sendingImg.value = true
      if (typeof msg.sendImage === 'function') await msg.sendImage(snapDataUrl.value)
      else await msg.sendMessage(`[image]\n${snapDataUrl.value}`)
      snapDataUrl.value = ''
    } finally {
      sendingImg.value = false
    }
  }

  function retake() {
    snapDataUrl.value = ''
  }

  watch(activeTab, (k) => {
    if (k === 'img' && isHider.value) startCamera(); else stopCamera()
  })
  onBeforeUnmount(stopCamera)

  /* =========================
     BONUS — TABLE LOCALE
     ========================= */
  const BONUS_TABLE_KEY = computed(() => session.game?.id ? `hns_bonus_table_${session.game.id}` : null)
  const localBonusTable = ref([]) // [{ uid, key, label, durationSec, unlockAtSec, used }]

  function loadBonusTable() {
    try {
      const k = BONUS_TABLE_KEY.value;
      if (!k) return
      const raw = localStorage.getItem(k)
      localBonusTable.value = raw ? JSON.parse(raw) : []
    } catch {
      localBonusTable.value = []
    }
  }

  function saveBonusTable() {
    try {
      const k = BONUS_TABLE_KEY.value;
      if (!k) return
      localStorage.setItem(k, JSON.stringify(localBonusTable.value))
    } catch {
    }
  }

  const catalogMap = computed(() => new Map((rules.catalog || []).map(c => [c.key, c])))
  const labelOf = (key) => (catalogMap.value.get(key)?.label || key)

  /** base = FIN DE CACHE ou, si inconnue, start */
  const baseAtSec = computed(() => {
    const baseMs = (hideEndMs.value ?? startedAtMs.value)
    return baseMs ? Math.floor(baseMs / 1000) : null
  })

  function uidForRule(ev, idx) {
    return ev?.id ? `id:${ev.id}` : `sig:${ev?.type}|t:${Number(ev?.time || 0)}|d:${Number(ev?.duration_sec || 0)}|#${idx}`
  }

  /** fusionne/initialise localBonusTable à partir des règles (time = secondes après FIN DE CACHE) */
  function mergeBonusTableFromRules() {
    const tl = Array.isArray(rules.timeline) ? rules.timeline : []
    const base = baseAtSec.value

    const byUid = new Map(localBonusTable.value.map(b => [b.uid, b]))
    const next = []

    for (let i = 0; i < tl.length; i++) {
      const ev = tl[i]
      if (!ev || !ev.type || ev.type === 'end') continue

      const uid = uidForRule(ev, i)
      const cat = catalogMap.value.get(ev.type) || {}
      const durationSec = Number(ev.duration_sec ?? cat.default_duration_sec ?? 0) || 0
      const t = Number(ev.time ?? 0) // secondes après FIN DE CACHE

      let unlockAtSec = null
      if (t > 0) unlockAtSec = base != null ? base + t : null
      else unlockAtSec = base // 0 => dispo dès la fin de cache (quand base connue)

      const was = byUid.get(uid)
      next.push({
        uid,
        key: ev.type,
        label: cat.label || ev.type,
        durationSec,
        unlockAtSec,
        used: was?.used ?? false,
      })
    }

    localBonusTable.value = next
    saveBonusTable()
  }

  /* ===== Un seul bonus actif à la fois ===== */
  const pickedBonus = ref(null)
  const activeRemainingMs = ref(0)
  const bonusLocked = computed(() => !!pickedBonus.value && activeRemainingMs.value > 0)

  /** Boutons visibles : non used, débloqués ET pas de bonus actif */
  const availableBonuses = computed(() => {
    if (bonusLocked.value) return []
    const nowSec = nowSecReactive.value
    const table = Array.isArray(localBonusTable.value) ? localBonusTable.value : []
    return table.filter(b => {
      if (!b || b.used) return false
      const unlock = b.unlockAtSec
      return unlock != null && unlock <= nowSec
    })
  })



  const nextBonusEntry = computed(() => {
    if (bonusLocked.value) return null
    const nowSec = nowSecReactive.value
    let pick = null
    for (const b of localBonusTable.value) {
      if (!b || b.used) continue
      const u = b.unlockAtSec
      if (u != null && u > nowSec) {
        if (!pick || u < pick.unlockAtSec) pick = b
      }
    }
    return pick
  })

  const nextBonusMs = computed(() => {
    const nb = nextBonusEntry.value
    if (!nb) return -1
    const diff = (nb.unlockAtSec - nowSecReactive.value) * 1000
    return Math.max(0, diff)
  })

  const nextBonusLabel = computed(() => nextBonusEntry.value?.label || '')



  function markUsed(uid) {
    const idx = localBonusTable.value.findIndex(x => x.uid === uid)
    if (idx >= 0 && !localBonusTable.value[idx].used) {
      localBonusTable.value[idx] = {...localBonusTable.value[idx], used: true}
      saveBonusTable()
    }
  }

  /* démarrage local synchronisé (amène tout le monde sur l’onglet Bonus) */
  const timersBySid = ref(new Map())

  function scheduleLocalBonusRun({uid, key, label, applyAtSec, durationSec, sid}) {
    if (timersBySid.value.has(sid)) return
    // ► on bascule l’onglet Bonus tout de suite
    if (isSeeker.value) setTab('bonus')

    const startFn = () => {
      if (bonusLocked.value) {
        timersBySid.value.delete(sid);
        return
      }
      const endMs = applyAtSec * 1000 + durationSec * 1000
      pickedBonus.value = {uid, key, label, endMs, durationSec}
      activeRemainingMs.value = Math.max(0, endMs - nowServer())
      const tid = timersBySid.value.get(sid)
      if (tid) {
        clearTimeout(tid);
        timersBySid.value.delete(sid)
      }
    }
    const delayMs = Math.max(0, applyAtSec * 1000 - nowServer())
    const tid = setTimeout(startFn, delayMs)
    timersBySid.value.set(sid, tid)
    if (delayMs === 0) startFn()
  }

  async function scheduleBonusFromFront(b) {
    if (!isSeeker.value || bonusLocked.value) return

    // Passe immédiatement sur l’onglet Bonus pour l’émetteur
    setTab('bonus')

    // Marque utilisé localement
    markUsed(b.uid)

    const applyAtSec = Math.floor(nowServer() / 1000) + SCHEDULE_DELAY_SEC

    // Message système (sync alliés)
    const payload = `${SYS_PREFIX}${SYS_TYPE_SCHEDULE}|uid=${b.uid}|key=${b.key}|apply_at=${applyAtSec}|duration=${b.durationSec}|by=${session.player?.id || ''}`
    try {
      await msg.sendMessage(payload)
    } catch {
    }

    // Audit API (facultatif)
    try {
      await game.claimBonus?.(b.key)
    } catch {
    }

    // Lance localement
    scheduleLocalBonusRun({
      uid: b.uid,
      key: b.key,
      label: b.label,
      applyAtSec,
      durationSec: b.durationSec,
      sid: `front:${b.uid}:${applyAtSec}`
    })
  }

  /* Messages systèmes reçus → synchro alliés (+ switch onglet) */
  const processedSys = ref(new Set())
  watch(() => msg.messages?.length || 0, () => {
    if (!isSeeker.value) return
    for (const m of (msg.messages || [])) {
      if (processedSys.value.has(m.id)) continue
      const sys = parseSystem(m.content)
      if (sys?.type === SYS_TYPE_SCHEDULE) {
        processedSys.value.add(m.id)
        const uid = String(sys.uid || '')
        const key = String(sys.key || '')
        const label = labelOf(key)
        const applyAt = Number(sys.apply_at || 0)
        const dur = Number(sys.duration || 0) || 0

        // Tous les chasseurs : used + on affiche l’onglet Bonus
        markUsed(uid)
        setTab('bonus')

        scheduleLocalBonusRun({
          uid,
          key,
          label,
          applyAtSec: applyAt,
          durationSec: dur,
          sid: `sys:${uid}:${applyAt}`
        })
      }
    }
    if (autoscroll.value) scrollToBottom(true)
  })

  /* =========================
     POLLING
     ========================= */
  const msgPollId = ref(null)

  async function startMessageLoop() {
    try {
      if (typeof msg.initPolling === 'function') {
        await msg.initPolling()
      } else if (typeof msg.fetchInitial === 'function') {
        await msg.fetchInitial()
        msgPollId.value = setInterval(() => msg.fetchSince?.(), 1500)
      }
    } catch {
    }
  }

  function stopMessageLoop() {
    try {
      msg.stopPolling?.()
    } catch {
    }
    if (msgPollId.value) {
      clearInterval(msgPollId.value);
      msgPollId.value = null
    }
  }

  const pollPlayersId = ref(null)

  function syncMyRole(players) {
    const meId = session.player?.id
    const me = players?.find(p => p.id === meId)
    if (me && me.role && session.player?.role !== me.role) {
      if (typeof session.setPlayer === 'function') session.setPlayer({
        ...session.player,
        role: me.role
      })
      else if (session.player) session.player.role = me.role
    }
  }

  async function refreshPlayers() {
    if (leaving.value || goingHome.value) return
    try {
      const {players} = await game.getPlayers()
      playersCount.value = players?.length || 0
      syncMyRole(players)
      if (playersCount.value < 3) await quit({
        silent: true,
        keepAuth: true,
        reason: 'Partie terminée (moins de 3 joueurs).'
      })
    } catch {
      await quit({silent: true, keepAuth: true})
    }
  }

  /* — Règles : on refetch pour permettre l’ajout de bonus par le chef — */
  const rulesPollId = ref(null)

  async function refreshRules() {
    try {
      await rules.fetchRules?.(session.game?.id)
      mergeBonusTableFromRules()
    } catch {
    }
  }

  watch(() => rules.timeline?.length || 0, () => mergeBonusTableFromRules())
  watch(() => rules.catalog?.length || 0, () => mergeBonusTableFromRules())
  watch(() => (hideEndMs.value ?? 0), () => mergeBonusTableFromRules()) // recalcul quand la base change

  /* =========================
     QUIT & CLEANUP
     ========================= */
  const goingHome = ref(false)

  function cleanup() {
    try {
      if (rafId) cancelAnimationFrame(rafId)
    } catch {
    }
    try {
      if (pollPlayersId.value) clearInterval(pollPlayersId.value)
    } catch {
    }
    try {
      if (rulesPollId.value) clearInterval(rulesPollId.value)
    } catch {
    }
    stopMessageLoop()
    stopCamera()
    for (const [, tid] of timersBySid.value) clearTimeout(tid)
    timersBySid.value.clear()
  }

  function clearLocalGame() {
    try {
      if (typeof session.setGame === 'function') session.setGame(null)
      else session.game = null
    } catch {
    }
  }

  async function goLobbyOnce(reason = '') {
    if (goingHome.value) return
    goingHome.value = true
    menuOpen.value = false
    try {
      if (typeof router.hasRoute === 'function' && router.hasRoute('home')) {
        await router.replace({name: 'home'})
      } else {
        await router.replace('/')
      }
    } catch {
    }
    setTimeout(() => {
      const r = router.currentRoute?.value
      const onHome = r?.name === 'home' || r?.path === '/'
      if (!onHome) window.location.href = '/'
      if (reason) alert(reason)
    }, 0)
  }

  async function quit({silent = true, keepAuth = true, reason = ''} = {}) {
    if (leaving.value) return
    leaving.value = true
    if (!silent && !confirm('Quitter la partie ?')) {
      leaving.value = false;
      return
    }
    try {
      await Promise.race([
        game.removePlayer?.(),
        new Promise(res => setTimeout(res, 1200)),
      ])
    } catch {
    }
    cleanup()
    clearLocalGame()
    if (!keepAuth) session.clearAuth?.()
    await goLobbyOnce(reason)
    leaving.value = false
  }

  /* =========================
     INIT
     ========================= */
  function ensureInGame() {
    session.loadFromStorage?.()
    return !!(session.isAuthenticated && session.game?.id)
  }

  async function init() {
    ready.value = false
    if (!ensureInGame()) {
      await goLobbyOnce();
      return
    }

    // Game
    try {
      const {game: g} = await game.getGame({id: session.game.id})
      if (!g?.id) throw new Error('no_game')
      startedAtMs.value = g.started_at ? Number(g.started_at) * 1000 : null
      maxTotalMs.value = g.max_duration_sec ? Number(g.max_duration_sec) * 1000 : 0
      nowMs.value = nowServer()
    } catch {
      await goLobbyOnce();
      return
    }

    // Players
    try {
      const {players} = await game.getPlayers();
      playersCount.value = players?.length || 0;
      syncMyRole(players)
    } catch {
    }

    // Catalog + Rules
    try {
      await rules.fetchCatalog?.()
    } catch {
    }
    try {
      await rules.fetchRules?.(session.game?.id)
    } catch {
    }

    // Bonus table locale
    loadBonusTable()
    mergeBonusTableFromRules()

    // Images notif
    loadSeen()

    // Loops
    try {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(rafTick)
    } catch {
    }
    try {
      if (pollPlayersId.value) clearInterval(pollPlayersId.value);
      await refreshPlayers();
      pollPlayersId.value = setInterval(refreshPlayers, 2000)
    } catch {
    }
    try {
      await startMessageLoop()
    } catch {
    }
    try {
      if (rulesPollId.value) clearInterval(rulesPollId.value);
      rulesPollId.value = setInterval(refreshRules, 4000)
    } catch {
    }

    nextTick(() => scrollToBottom(false))
    ready.value = true
  }

  /* =========================
     UTILS
     ========================= */
  function pad(n) {
    return n < 10 ? '0' + n : '' + n
  }

  function fmtMs(ms) {
    const t = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(t / 60), s = t % 60;
    return `${pad(m)}:${pad(s)}`
  }

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
    position: relative;
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

  .badge {
    position: absolute;
    top: 4px;
    right: 8px;
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    border-radius: 999px;
    background: #ef4444;
    color: #fff;
    font-size: 12px;
    line-height: 18px;
    font-weight: 800;
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

  /* Images panel */
  .img-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
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

  /* Dernière image (chercheur) */
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

  /* Bottom sheet (historique) */
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, .35);
    z-index: 69;
  }

  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    transform: translateY(calc(110% + var(--dragY, 0px)));
    transition: transform .25s ease;
    background: #0f1115;
    border-top: 1px solid #232323;
    border-radius: 12px 12px 0 0;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    z-index: 70;
  }

  .sheet.open {
    transform: translateY(0);
  }

  .sheet-grabber {
    width: 56px;
    height: 5px;
    background: #2b2f3a;
    border-radius: 999px;
    margin: 4px auto 2px;
  }

  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .sheet-list {
    overflow: auto;
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    padding-bottom: 12px;
  }

  .sheet-item {
    border: 1px solid #232323;
    border-radius: 10px;
    overflow: hidden;
    background: #0b0e14;
    cursor: pointer;
  }

  .sheet-item img {
    width: 100%;
    display: block;
  }

  .sheet-meta {
    padding: 6px 8px;
  }

  .sheet-line {
    font-size: 12px;
  }

  .sheet-line.small {
    opacity: .7;
    font-size: 11px;
  }

  /* Bonus */
  .bonus-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .timer-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
  }

  .countdown {
    padding: 2px 8px;
    border-radius: 999px;
    background: #222b;
    border: 1px solid #2b2f3a;
    font-weight: 800;
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

  .bonus-feed {
    margin: 0;
    padding-left: 18px;
    opacity: .75;
  }

  .bubble.sys {
    margin-left: 0;
    margin-right: 0;
    display: flex;
    justify-content: center;
  }
  .sys-bubble {
    padding: 4px 10px;
    border-radius: 12px;
    background: #20242c;
    color: #e8e8e8;
    font-size: 12px;
    font-weight: 700;
    box-shadow: 0 1px 0 rgba(0,0,0,.25) inset, 0 1px 0 rgba(255,255,255,.06);
  }
</style>

