<template>
  <div class="map-wrap">
    <div ref="mapRef" class="map"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  pollMs:   { type: Number, default: 1500 },
  staleSec: { type: Number, default: 300 }, // 5 min par défaut
  includeMe:{ type: Boolean, default: true }
})

import { useGameStore } from '@/stores/game'
const game = useGameStore()

const mapRef = ref(null)
let map
let markers = new Map()
let accCircles = new Map()
let pollId = null
let fittedOnce = false

function normalizeRow(r){
  // tolère plusieurs noms de champs
  const lat = r?.lat ?? r?.latitude ?? r?.last_lat
  const lng = r?.lng ?? r?.longitude ?? r?.last_lng
  if (lat == null || lng == null) return null
  return {
    id: r.id ?? r.player_id ?? r.pid ?? crypto.randomUUID(),
    name: r.name ?? 'Joueur',
    role: r.role ?? r.r ?? 'hider',
    lat: Number(lat),
    lng: Number(lng),
    accuracy: r.accuracy != null ? Number(r.accuracy) : (r.acc != null ? Number(r.acc) : null),
    updated_at: Number(r.updated_at ?? r.ts ?? r.time ?? 0)
  }
}
function extractRows(payload){
  const arr = Array.isArray(payload?.players) ? payload.players
    : Array.isArray(payload?.rows)    ? payload.rows
      : []
  return arr.map(normalizeRow).filter(Boolean)
}

function colorFor(nowSec, updatedAt){
  if (!props.staleSec || props.staleSec < 0) return '#ef4444'
  const stale = (nowSec - (updatedAt || 0)) > props.staleSec
  return stale ? '#6b7280' : '#ef4444'
}

function ensureMarker(key, lat, lng, color, radius){
  const ll = L.latLng(lat, lng)
  let m = markers.get(key)
  if (!m){
    m = L.circleMarker(ll, { radius, color, weight: 2, fillOpacity: 0.8 })
    m.addTo(map)
    markers.set(key, m)
  } else {
    m.setLatLng(ll)
    m.setStyle({ color })
  }
  return m
}
function ensureAccCircle(key, lat, lng, acc){
  let c = accCircles.get(key)
  if (!c){
    c = L.circle([lat, lng], { radius: acc, color:'#9ca3af', weight:1, opacity:.6, fillOpacity:.05 })
    c.addTo(map)
    accCircles.set(key, c)
  } else {
    c.setLatLng([lat, lng]); c.setRadius(acc)
  }
}
function cleanupGarbage(validKeys){
  for (const [k, m] of markers) if (!validKeys.has(k)){ m.remove(); markers.delete(k) }
  for (const [k, c] of accCircles) if (!validKeys.has(k)){ c.remove(); accCircles.delete(k) }
}

async function refresh(){
  let payload
  try {
    payload = await game.getLocations()
  } catch (e) {
    console.error('[map] get_locations failed', e)
    return
  }
  console.debug('[map] get_locations payload:', payload)

  const nowSec = Math.floor(Date.now()/1000)
  const rows   = extractRows(payload)
  const valid  = new Set()

  // Cacheurs
  for (const p of rows){
    if (p.role !== 'hider') continue
    const col = colorFor(nowSec, p.updated_at)
    const key = `h:${p.id}`
    const m = ensureMarker(key, p.lat, p.lng, col, 7)
    m.bindTooltip(p.name)
    valid.add(key)
    if (p.accuracy != null && p.accuracy > 0 && p.accuracy < 60){
      ensureAccCircle(key, p.lat, p.lng, p.accuracy)
      valid.add(`acc:${key}`)
    }
  }

  // Moi (bleu)
  const meRow = normalizeRow(payload?.me || null)
  if (props.includeMe && meRow){
    const key = `me:${meRow.id}`
    ensureMarker(key, meRow.lat, meRow.lng, '#3b82f6', 8)
    valid.add(key)
    if (meRow.accuracy != null && meRow.accuracy > 0 && meRow.accuracy < 60){
      ensureAccCircle(key, meRow.lat, meRow.lng, meRow.accuracy)
      valid.add(`acc:${key}`)
    }
  }

  cleanupGarbage(valid)

  // Fit bounds une seule fois s’il y a au moins 1 point
  if (!fittedOnce && markers.size){
    const bounds = L.latLngBounds(Array.from(markers.values()).map(m => m.getLatLng()))
    map.fitBounds(bounds.pad(0.25))
    fittedOnce = true
  }
}

onMounted(() => {
  map = L.map(mapRef.value, { zoomControl: true })
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map)
  map.setView([46.5, 6.6], 3) // vue mondiale par défaut

  refresh()
  pollId = setInterval(refresh, Math.max(700, props.pollMs))
})
onBeforeUnmount(() => {
  if (pollId) clearInterval(pollId)
  try { map && map.remove() } catch {}
})
</script>

<style scoped>
.map-wrap{ width:100%; }
.map{ width:100%; height:320px; border:1px solid #232323; border-radius:10px; overflow:hidden; }
</style>
