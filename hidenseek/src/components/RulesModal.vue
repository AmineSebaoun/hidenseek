<!-- src/components/RulesModal.vue -->
<template>
  <teleport to="body">
    <div class="rules-modal" v-if="open">
      <div class="overlay" @click="close()" />
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Règles">
        <div class="dialog-header">
          <h2>Règles de la partie</h2>
          <button class="btn btn-tiny" @click="close()">✕</button>
        </div>

        <div class="dialog-body">
          <!-- Temps max -->
          <section class="block">
            <label class="label">
              ⏱️ Temps maximum
              <span class="hint">(minutes, 0 = illimité)</span>
            </label>
            <input
              type="number"
              min="0"
              class="input w-140"
              v-model.number="maxMinutes"
            />
          </section>

          <!-- Formulaire d'ajout d'événement -->
          <section class="block">
            <h3 class="subtitle">➕ Ajouter un événement</h3>
            <div class="add-row">
              <input v-model.number="newTime" type="number" min="0" placeholder="Temps (s)" class="input w-120" />
              <input v-model.number="newDuration" :disabled="newType==='end'" type="number" min="0" placeholder="Durée (s)" class="input w-120" />
              <select v-model="newType" class="input">
                <option v-for="b in rules.catalog" :key="b.key" :value="b.key">Bonus: {{ b.label }}</option>
                <option value="end">Fin de partie</option>
              </select>
              <button class="btn" @click="applyEvent">Ajouter</button>
            </div>
            <p class="hint mt-6">
              Astuce : la durée se met par défaut selon le bonus choisi.
            </p>
          </section>

          <!-- Frise -->
          <section class="block">
            <h3 class="subtitle">🧭 Frise chronologique</h3>
            <p v-if="!previewTimeline.length" class="hint">Aucun événement pour l’instant.</p>
            <ul v-else class="timeline">
              <li v-for="(ev, i) in previewTimeline" :key="ev.id || i" class="timeline-item">
                <div class="time">{{ ev.time }}s</div>
                <div class="what">{{ labelFor(ev.type) }}</div>
                <div class="dur" v-if="ev.type !== 'end'">Durée: {{ ev.duration_sec }}s</div>
                <button class="link danger" @click="onDelete(i, ev)">Supprimer</button>
              </li>
            </ul>
          </section>
        </div>

        <div class="dialog-footer">
          <button class="btn btn-ghost" @click="close()">Fermer</button>
          <button class="btn btn-primary" :disabled="rules.loading" @click="save()">Enregistrer</button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useRulesStore } from '@/stores/rules'

const props = defineProps({ open: { type: Boolean, required: true } })
const emit  = defineEmits(['close'])

const rules       = useRulesStore()
const newTime     = ref(0)
const newDuration = ref(30)
const newType     = ref('end')

// Bloque le scroll du body
function lockScroll (lock) { document.documentElement.style.overflow = lock ? 'hidden' : '' }

// À l’ouverture : on charge, puis si l’API ne renvoie rien, on pré-remplit
watch(() => props.open, async isOpen => {
  lockScroll(isOpen)
  if (!isOpen) return
  try {
    await rules.fetchCatalog()
    await rules.fetchRules()

    // 🧠 Auto-préremplissage depuis la dernière frise locale
    // UNIQUEMENT si l’API est vide (pas de durée max & pas d’événements)
    rules.prefillFromLastIfEmpty()

    // Valeurs par défaut du formulaire
    newType.value = rules.catalog[0]?.key || 'end'
    const def = rules.catalog.find(b => b.key === newType.value)?.default_duration_sec ?? 30
    newDuration.value = def
  } catch (e) {
    console.error('Erreur rules/catalog', e)
  }
})

onBeforeUnmount(() => lockScroll(false))

// ↔️ Champ minutes bi-directionnel pour éviter le bug "un seul chiffre"
const maxMinutes = computed({
  get: () => Math.floor((rules.game?.max_duration_sec || 0) / 60),
  set: (m) => rules.setEnd(Math.max(0, Number(m || 0)) * 60),
})

// Met à jour la durée par défaut quand on change de type
watch(newType, (k) => {
  if (k === 'end') return (newDuration.value = 0)
  const def = rules.catalog.find(b => b.key === k)?.default_duration_sec
  if (typeof def === 'number') newDuration.value = def
})

// Timeline d’aperçu (ajoute fin si pas posée manuellement mais max > 0)
const previewTimeline = computed(() => {
  const list = [...rules.timeline]
  const hasManualEnd = list.some(ev => ev.type === 'end')
  if (!hasManualEnd && rules.game?.max_duration_sec > 0) {
    list.push({ time: rules.game.max_duration_sec, type: 'end', duration_sec: 0 })
  }
  return list.sort((a, b) => a.time - b.time)
})

function labelFor (type) {
  if (type === 'end') return 'Fin de partie'
  const b = rules.catalog.find(x => x.key === type)
  return b ? `Bonus: ${b.label}` : type
}

// Vérifie si [t, t+d) chevauche un autre bonus existant
function overlapsExisting(t, d) {
  return rules.timeline.some(ev => {
    if (ev.type === 'end') return false
    const a1 = Number(ev.time) || 0
    const a2 = a1 + (Number(ev.duration_sec) || 0)
    const b1 = t
    const b2 = t + d
    return a1 < b2 && b1 < a2
  })
}

function applyEvent () {
  const t = Math.max(0, Number(newTime.value || 0))
  const d = Math.max(0, Number(newDuration.value || 0))
  const type = newType.value

  // Interdiction après fin de partie si max défini
  const endGame = Number(rules.game?.max_duration_sec || 0)
  if (endGame > 0) {
    if (type === 'end' && t !== endGame) {
      alert(`La fin de partie est à ${endGame}s (définie par la durée max). Modifie la durée max si besoin.`)
      return
    }
    if (type !== 'end' && t >= endGame) {
      alert(`Impossible d'ajouter un bonus après la fin (${endGame}s).`)
      return
    }
    if (type !== 'end' && t + d > endGame) {
      alert(`Le bonus dépasse la fin de partie (${endGame}s). Raccourcis-le ou déplace-le.`)
      return
    }
  }

  // Pas de chevauchements
  if (type !== 'end' && overlapsExisting(t, d)) {
    alert('Ce bonus chevauche un autre bonus. Décale-le ou change sa durée.')
    return
  }

  if (type === 'end') {
    rules.setEnd(t)
  } else {
    rules.addEvent(type, t, d)
  }

  // Reset rapide
  newTime.value = 0
  const def = rules.catalog.find(b => b.key === newType.value)?.default_duration_sec ?? 30
  newDuration.value = def
}

async function onDelete (index, ev) {
  try {
    if (ev.type === 'end') {
      rules.setEnd(0)
    } else {
      await rules.removeEventAt(index)
    }
  } catch (e) {
    console.error('Suppression échouée', e)
    alert("La suppression a échoué.")
  }
}

async function save () {
  try {
    await rules.saveRules({
      maxDurationSec: rules.game?.max_duration_sec || 0,
      scheduledStartTs: rules.game?.scheduled_start_ts || null,
    })
    close()
  } catch (e) {
    console.error('Erreur lors de la sauvegarde', e)
    alert("La sauvegarde a échoué.")
  }
}

function close () { lockScroll(false); emit('close') }
</script>

<style scoped>
.rules-modal { position: fixed; inset: 0; z-index: 9999; }
.overlay { position:absolute; inset:0; background:rgba(0,0,0,.65); backdrop-filter: blur(4px); }
.dialog { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  width:980px; max-width:95vw; max-height:92vh; overflow:auto; background:#0f1115; color:#fff;
  border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.5); border:1px solid rgba(255,255,255,.08); }
.dialog-header, .dialog-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; }
.dialog-header h2 { margin:0; font-size:20px; font-weight:800; }
.dialog-body { padding:0 18px 16px 18px; }

.block { margin:18px 0; }
.label { display:block; margin-bottom:6px; font-weight:600; }
.subtitle { margin:0 0 8px 0; font-weight:700; }
.hint { opacity:.7; font-size:12px; }
.mt-6 { margin-top:6px; }

.input { padding:10px 12px; border-radius:10px; border:1px solid #2b2f3a; background:#0b0e14; color:#eee; }
.w-120 { width:120px; }
.w-140 { width:140px; }

.btn { padding:10px 14px; border-radius:10px; border:1px solid #3b3b3b; background:#1b1b1b; color:#eee; cursor:pointer; }
.btn-primary { background:#10b981; border-color:#10b981; color:#07130e; font-weight:700; }
.btn-ghost { background:transparent; }
.btn-tiny { padding:6px 10px; }

.timeline { list-style:none; margin:0; padding:0; }
.timeline-item { display:grid; grid-template-columns:80px 1fr auto auto; align-items:center; gap:10px;
  padding:8px 10px; border-radius:10px; background:#141821; border:1px solid rgba(255,255,255,.08); }
.time { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight:800; color:#34d399; }
.what { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dur { font-size:12px; opacity:.8; }
.link { background:none; border:none; padding:0; color:#58a6ff; cursor:pointer; }
.link.danger { color:#ff6b6b; }
.add-row { display:flex; gap:8px; align-items:center; flex-wrap: wrap; }
</style>
