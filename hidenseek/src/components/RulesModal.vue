<template>
  <!-- On sort du flux normal : modal par-dessus la page -->
  <Teleport to="body">
    <div v-if="open" class="modal-root" @keydown.esc="$emit('close')" tabindex="-1">
      <!-- Overlay sombre + flou (clique pour fermer) -->
      <div class="overlay" @click="$emit('close')"></div>

      <!-- Fenêtre centrée -->
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <div class="panel-header">
          <h2 id="rules-title">Règles (frise chronologique)</h2>
          <button class="btn tiny" @click="$emit('close')" aria-label="Fermer">✕</button>
        </div>

        <!-- Temps maximum (UI en minutes) -->
        <div class="block">
          <label class="label">Temps maximum (minutes, 0 = illimité)</label>
          <input v-model.number="maxTimeMin" type="number" min="0" class="input" />
          <p class="muted">Si &gt; 0, on ajoute/maj un événement <code>end</code> à ce temps.</p>
        </div>

        <!-- Frise chronologique (style “cards”) -->
        <div class="block">
          <h3 class="subtitle">Frise chronologique</h3>

          <div v-if="!sorted.length" class="muted">Aucun événement pour l’instant.</div>

          <ul v-else class="timeline">
            <li v-for="(r, i) in sorted" :key="i" class="tl-row">
              <!-- colonne gauche : ligne + pastille -->
              <div class="tl-col">
                <div v-if="i>0" class="tl-line tl-top"></div>
                <div v-if="i<sorted.length-1" class="tl-line tl-bottom"></div>
                <span class="tl-dot" :class="dotClass(r.type)"></span>
              </div>

              <!-- carte -->
              <article class="card">
                <div class="time-badge" :class="badgeClass(r.type)">
                  {{ minutesOf(r.time) }} min
                </div>
                <div class="card-body">
                  <div class="card-title">{{ labels[r.type] || r.type }}</div>
                </div>
                <div class="card-actions">
                  <button class="link danger" @click="remove(r, i)">Supprimer</button>
                </div>
              </article>
            </li>
          </ul>
        </div>

        <!-- Ajouter un événement -->
        <div class="add-row">
          <input v-model.number="newTimeMin" type="number" min="0" placeholder="Temps (min)" class="input" />
          <select v-model="newType" class="input">
            <option value="reveal">Révélation positions</option>
            <option value="bonus">Bonus</option>
            <option value="end">Fin de partie</option>
          </select>
          <button class="btn" @click="add">Ajouter</button>
        </div>

        <!-- Actions -->
        <div class="footer">
          <button class="btn ghost" @click="$emit('close')">Fermer</button>
          <button class="btn primary" @click="save">Enregistrer</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRulesStore } from '@/stores/rules'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const rules = useRulesStore()

// UI en minutes
const maxTimeMin = ref(0)
const newTimeMin = ref(0)
const newType = ref('reveal')

// libellés
const labels = {
  reveal: 'Révélation positions',
  bonus: 'Bonus',
  end: 'Fin de partie'
}

// tri croissant par temps (sec)
const sorted = computed(() =>
  [...rules.rules].sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
)

// au moment d’ouvrir : on charge + on mappe l’event `end` en minutes
watch(() => props.open, async (isOpen) => {
  // scroll-lock
  document.documentElement.style.overflow = isOpen ? 'hidden' : ''
  if (!isOpen) return
  await rules.fetchRules().catch(()=>{})
  const end = rules.rules.find(r => r.type === 'end')
  maxTimeMin.value = end ? Math.round((Number(end.time) || 0) / 60) : 0
})

// ESC fonctionne même sans focus sur un input
onMounted(() => window.addEventListener('keydown', onEsc))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEsc)
  document.documentElement.style.overflow = ''
})
function onEsc(e){ if (e.key === 'Escape' && props.open) emit('close') }

// helpers
function minutesOf(seconds){
  return Math.round((Number(seconds || 0) / 60) * 10) / 10
}

// Ajouter
function add(){
  const minutes = Number(newTimeMin.value || 0)
  if (minutes < 0) return
  rules.addRule({ time: Math.round(minutes * 60), type: newType.value })
  newTimeMin.value = 0
  newType.value = 'reveal'
}

// Supprimer
function remove(rule, idx){
  rules.removeRule(idx)
  if (rule.type === 'end') maxTimeMin.value = 0
}

// Enregistrer (gère l’event 'end' à partir de maxTimeMin)
async function save(){
  const endIdx = rules.rules.findIndex(r => r.type === 'end')
  if (maxTimeMin.value > 0) {
    const endEvt = { time: Math.round(Number(maxTimeMin.value) * 60), type: 'end' }
    if (endIdx >= 0) rules.rules.splice(endIdx, 1, endEvt)
    else rules.addRule(endEvt)
  } else if (endIdx >= 0) {
    rules.rules.splice(endIdx, 1)
  }
  await rules.saveRules().catch(()=>{})
  emit('close')
}

// styles dynamiques
function dotClass(t){
  switch (t) {
    case 'reveal': return 'dot-purple'
    case 'bonus':  return 'dot-green'
    case 'end':    return 'dot-red'
    default:       return 'dot-gray'
  }
}
function badgeClass(t){
  switch (t) {
    case 'reveal': return 'badge-purple'
    case 'bonus':  return 'badge-green'
    case 'end':    return 'badge-red'
    default:       return 'badge-gray'
  }
}
</script>

<style scoped>
/* ======================= */
/* Layout & overlay modal  */
/* ======================= */
.modal-root{
  position: fixed; inset: 0; z-index: 9999;
  display: grid; place-items: center;
}
.overlay{
  position: absolute; inset: 0;
  background: rgba(0,0,0,.65);
  backdrop-filter: blur(3px);
}
.panel{
  position: relative;
  width: min(920px, 95vw);
  max-height: 90vh; overflow: auto;
  background: #0f1115; color: #fff;
  border-radius: 18px;
  padding: 18px;
  box-shadow: 0 24px 80px rgba(0,0,0,.55);
  border: 1px solid rgba(255,255,255,.08);
}
.panel-header{
  display:flex; align-items:center; justify-content:space-between;
  margin-bottom: 10px;
}
.panel-header h2{ font-size: 22px; font-weight: 800; }

.block{ margin: 14px 0 18px; }
.subtitle{ margin: 0 0 10px; font-weight: 700; }
.label{ display:block; margin-bottom:6px; }

/* ======================= */
/* Inputs & buttons        */
/* ======================= */
.input{
  padding: 10px 12px; border-radius: 10px;
  border: 1px solid #2b2f3a; background:#0b0e14; color:#eee;
  width: 100%;
}
.btn{
  padding: 10px 14px; border-radius: 10px; cursor:pointer;
  border: 1px solid #3b3b3b; background:#1b1b1b; color:#eee;
}
.btn.primary{ background:#10b981; border-color:#10b981; color:#07130e; font-weight:700; }
.btn.ghost{ background:transparent; }
.btn.tiny{ padding:6px 10px; }
.link{ cursor:pointer; border:none; background:transparent; color:#86c5ff; }
.link.danger{ color:#ff8f8f; }
.muted{ opacity:.7; font-size:12px; }

/* ======================= */
/* Timeline                */
/* ======================= */
.timeline{ position:relative; margin: 8px 0; padding-left: 44px; list-style:none; }
.tl-row{ position:relative; display:grid; grid-template-columns: 32px 1fr; gap:12px; margin: 12px 0; }
.tl-col{ position:relative; }
.tl-line{
  position:absolute; left: 50%; width:1px; background: rgba(255,255,255,.12);
  transform:translateX(-50%);
}
.tl-top{ top:0; bottom:50%; }
.tl-bottom{ top:50%; bottom:0; }
.tl-dot{
  position:absolute; top:50%; left:50%;
  transform:translate(-50%, -50%);
  width:10px; height:10px; border-radius:50%;
  box-shadow: 0 0 0 4px #0f1115;
}
.dot-purple{ background:#8b5cf6; }
.dot-green{ background:#10b981; }
.dot-red{ background:#ef4444; }
.dot-gray{ background:#94a3b8; }

/* Card */
.card{
  display:grid; grid-template-columns: 140px 1fr auto; align-items:center;
  background:#141821; border-radius: 12px; overflow:hidden;
  border: 1px solid rgba(255,255,255,.08);
  box-shadow: 0 10px 30px rgba(0,0,0,.25);
}
.time-badge{
  text-align:center; padding: 14px 10px; font-weight: 800; letter-spacing:.3px;
  border-right: 1px solid transparent;
}
.badge-purple{ background: rgba(139,92,246,.18); border-right-color: rgba(139,92,246,.35); }
.badge-green{ background: rgba(16,185,129,.18); border-right-color: rgba(16,185,129,.35); }
.badge-red{ background: rgba(239,68,68,.20); border-right-color: rgba(239,68,68,.40); }
.badge-gray{ background: rgba(148,163,184,.20); border-right-color: rgba(148,163,184,.35); }

.card-body{ padding: 12px 14px; }
.card-title{ font-size: 14px; font-weight: 700; }
.card-actions{ padding: 12px; }

.add-row{
  display:grid; grid-template-columns: 1fr 1fr auto; gap:10px; margin: 12px 0 4px;
}
.footer{ display:flex; justify-content:flex-end; gap:10px; }
@media (max-width: 640px){
  .card{ grid-template-columns: 110px 1fr auto; }
  .add-row{ grid-template-columns: 1fr; }
}
</style>
