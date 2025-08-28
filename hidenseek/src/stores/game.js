// src/stores/game.js
import { defineStore } from 'pinia'
import axios from 'axios'
import { useSessionStore } from './session'
import { useTimeStore } from './time' // pour nowServerMs()

const API = 'https://hidenseek.infrason.ch/api/api.php'

// --- utils ---
function parseMaybeJSON(data) {
  if (typeof data === 'string') {
    try { return JSON.parse(data) } catch { return { raw: data } }
  }
  return data
}
function headers() {
  const session = useSessionStore()
  const h = { 'Content-Type': 'application/json' }
  if (session.token) h.Authorization = `Bearer ${session.token}`
  return h
}
const memKey = (gameId) => `hns_bonuses_${gameId}`

// ======================================================
// STORE
// ======================================================
export const useGameStore = defineStore('game', () => {
  const session = useSessionStore()
  const time = useTimeStore()

  // ---------------- Core game calls ----------------
  async function createGame(name) {
    const res = await axios.post(
      API,
      { action: 'create_game', name },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)
    if (res.status !== 200) throw new Error(data?.error || `create_game_http_${res.status}`)
    if (!data?.game) throw new Error('create_game_bad_payload')
    return data // { game }
  }

  // ✅ rôle correct : on prend param.role ou session.player.role, sinon on refuse
  async function joinGame({ code, name, role, team = 'random' } = {}) {
    const chosenRole = role || session.player?.role
    if (!chosenRole || !['seeker','hider'].includes(chosenRole)) {
      throw new Error('role_required') // l’UI doit fournir un rôle choisi
    }
    const res = await axios.post(
      API,
      { action: 'join_game', code, name, role: chosenRole, team },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)
    if (res.status !== 200) throw new Error(data?.error || `join_game_http_${res.status}`)
    return data // { player, token, game }
  }

  // ➜ récupère aussi la dernière position connue (loc_*)
  async function getPlayers() {
    const res = await axios.post(
      API,
      { action: 'get_players' },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)
    if (res.status !== 200) throw new Error(data?.error || `get_players_http_${res.status}`)

    const players = (data.players || []).map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      team: p.team,
      last_seen: Number(p.last_seen || 0),
      loc: {
        lat: p.loc_lat != null ? Number(p.loc_lat) : null,
        lng: p.loc_lng != null ? Number(p.loc_lng) : null,
        acc: p.loc_acc != null ? Number(p.loc_acc) : null,
        bearing: p.loc_bearing != null ? Number(p.loc_bearing) : null,
        at: p.loc_at != null ? Number(p.loc_at) : null,
      },
    }))

    return { players }
  }

  async function setRole(playerId, role) {
    const res = await axios.post(
      API,
      { action: 'set_role', player_id: playerId, role },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)
    if (res.status !== 200) throw new Error(data?.error || `set_role_http_${res.status}`)
    return data // { ok: true }
  }

  // Optionnel
  async function setTeam(playerId, team) {
    const res = await axios.post(
      API,
      { action: 'set_team', player_id: playerId, team },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)
    if (res.status !== 200) throw new Error(data?.error || `set_team_http_${res.status}`)
    return data // { ok: true }
  }

  // Lire état de la game (active/pending, started_at, max, scheduled_start_ts…)
  async function getGame({ id, code } = {}) {
    const res = await axios.post(
      API,
      { action: 'get_game', id, code },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)
    if (res.status !== 200) throw new Error(data?.error || `get_game_http_${res.status}`)
    return data // { game }
  }

  // Démarrer (vérifs côté API : host + rôles OK)
  async function startGame() {
    const res = await axios.post(
      API,
      { action: 'start_game' },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)
    if (res.status !== 200) throw new Error(data?.error || data?.message || `start_game_http_${res.status}`)
    return data // { ok:true, started_at }
  }

  /**
   * Programme un départ : on tente d’abord /schedule_start (avec validations),
   * sinon fallback legacy via set_rules.scheduled_start_ts.
   */
  async function scheduleStart(countdownSec = 3) {
    const tryNew = async () => {
      const res = await axios.post(
        API,
        { action: 'schedule_start', countdown_sec: Math.max(1, Number(countdownSec) || 3) },
        { headers: headers(), validateStatus: s => s < 500 }
      )
      const data = parseMaybeJSON(res.data)
      if (res.status !== 200) throw Object.assign(new Error(data?.error || `schedule_start_http_${res.status}`), { data, status: res.status })
      return { scheduled_start_ts: data.scheduled_start_ts, countdown_sec: data.countdown_sec }
    }
    const tryLegacy = async () => {
      const now = Math.floor((time?.nowServerMs?.() ?? Date.now()) / 1000)
      const ts  = now + Math.max(1, Number(countdownSec) || 3)
      const res = await axios.post(
        API,
        { action: 'set_rules', scheduled_start_ts: ts },
        { headers: headers(), validateStatus: s => s < 500 }
      )
      const data = parseMaybeJSON(res.data)
      if (res.status !== 200) throw new Error(data?.error || `schedule_start_legacy_http_${res.status}`)
      return { scheduled_start_ts: ts, countdown_sec: countdownSec }
    }

    try {
      return await tryNew()
    } catch (e) {
      // fallback silencieux si non-host/endpoint absent
      return await tryLegacy()
    }
  }

  // Quitter / expulser
  async function removePlayer(playerId = null) {
    const res = await axios.post(
      API,
      playerId ? { action: 'remove_player', player_id: playerId }
        : { action: 'remove_player' },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)
    if (res.status !== 200) throw new Error(data?.error || `remove_player_http_${res.status}`)
    return data // { ok:true, removed: id }
  }
  async function leaveGame() { return removePlayer(null) }

  // ======================================================
  //  GEO — update + helpers
  // ======================================================
  async function updateLocation({ lat, lng, acc=null, bearing=null }) {
    const res = await axios.post(API, {
      action: 'update_location',
      lat: Number(lat), lng: Number(lng),
      accuracy: acc != null ? Number(acc) : null,
      bearing:  bearing != null ? Number(bearing) : null,
    }, { headers: headers(), validateStatus: s => s < 500 })
    const data = parseMaybeJSON(res.data)
    if (res.status !== 200) throw new Error(data?.error || 'update_location_failed')
    return data
  }

  async function getLocations() {
    const res = await axios.post(API, { action: 'get_locations' },
      { headers: headers(), validateStatus: s => s < 500 })
    const data = parseMaybeJSON(res.data)
    if (res.status !== 200) throw new Error(data?.error || 'get_locations_failed')
    return data // {server_time, me, players:[...]}
  }

  function haversine(a, b) {
    const R = 6371000
    const toRad = d => d * Math.PI / 180
    const dLat = toRad((b.lat ?? 0) - (a.lat ?? 0))
    const dLng = toRad((b.lng ?? 0) - (a.lng ?? 0))
    const la1 = toRad(a.lat ?? 0), la2 = toRad(b.lat ?? 0)
    const x = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)))
  }

  // ======================================================
  //  BONUS — planning local + synchro déclenchement
  // ======================================================

  let plannedBonuses = []        // non-réactif
  const claimedKeys = new Set()  // persistant localement (par game)
  let startedAtMs = null

  function initBonusesFromRules({ timeline, catalog, startedAtSec }) {
    const gid = session.game?.id
    if (!gid || !Array.isArray(timeline) || !Array.isArray(catalog)) {
      plannedBonuses = []
      return
    }
    startedAtMs = startedAtSec ? Number(startedAtSec) * 1000 : null
    const byKey = new Map(catalog.map(b => [b.key, b]))

    plannedBonuses = timeline
      .filter(ev => ev && ev.type && ev.type !== 'end')
      .map(ev => {
        const b = byKey.get(ev.type)
        const label = b?.label || ev.type
        const atMs = startedAtMs != null ? (startedAtMs + (Number(ev.time) || 0) * 1000) : null
        return { id: ev.id || null, key: ev.type, label, atMs, duration_sec: Number(ev.duration_sec) || 0 }
      })
      .filter(x => x.atMs != null)
      .sort((a,b) => a.atMs - b.atMs)

    _loadClaimedFromStorage()
  }

  function getNextBonus(nowMs = time.nowServerMs?.() ?? Date.now()) {
    const next = plannedBonuses.find(b => !claimedKeys.has(b.key) && b.atMs > nowMs)
    if (!next) return { bonus: null, msUntil: -1 }
    return { bonus: next, msUntil: next.atMs - nowMs }
  }

  function getClaimableBonus(nowMs = time.nowServerMs?.() ?? Date.now()) {
    return plannedBonuses.find(b => !claimedKeys.has(b.key) && b.atMs <= nowMs) || null
  }

  async function claimBonus(key) {
    const target = plannedBonuses.find(b => b.key === key)
    if (!target) throw new Error('bonus_not_found')
    try {
      await axios.post(API, { action: 'trigger_bonus', key }, { headers: headers(), validateStatus: s => s < 500 })
    } catch (e) {
      console.warn('trigger_bonus failed, marking locally anyway', e?.response?.data || e)
    }
    claimedKeys.add(key)
    _saveClaimedToStorage()
    return { ok: true, key }
  }

  async function syncTriggeredFromServer() {
    try {
      const res = await axios.post(API, { action: 'events' }, { headers: headers(), validateStatus: s => s < 500 })
      const data = parseMaybeJSON(res.data)
      if (res.status !== 200) throw new Error(data?.error || `events_http_${res.status}`)
      const triggeredKeys = (data.bonuses || []).map(e => e.key).filter(Boolean)
      let changed = false
      for (const k of triggeredKeys) if (!claimedKeys.has(k)) { claimedKeys.add(k); changed = true }
      if (changed) _saveClaimedToStorage()
    } catch {}
  }

  function _loadClaimedFromStorage() {
    const gid = session.game?.id
    if (!gid) return
    try {
      const raw = localStorage.getItem(memKey(gid))
      if (!raw) return
      const data = JSON.parse(raw)
      const arr = Array.isArray(data?.claimed) ? data.claimed : []
      claimedKeys.clear()
      for (const k of arr) claimedKeys.add(k)
    } catch {}
  }
  function _saveClaimedToStorage() {
    const gid = session.game?.id
    if (!gid) return
    try { localStorage.setItem(memKey(gid), JSON.stringify({ claimed: Array.from(claimedKeys) })) } catch {}
  }
  function _resetBonusesForGame() {
    const gid = session.game?.id
    if (gid) { try { localStorage.removeItem(memKey(gid)) } catch {} }
    plannedBonuses = []
    claimedKeys.clear()
  }

  async function leaveAndReset() {
    try { await leaveGame() } catch {}
    _resetBonusesForGame()
  }

  function allPlannedBonuses() { return plannedBonuses.slice() }
  function claimedList() { return Array.from(claimedKeys) }

  return {
    // core
    createGame, joinGame, getPlayers, setRole, setTeam,
    getGame, startGame, scheduleStart,
    removePlayer, leaveGame, leaveAndReset,

    // geo
    updateLocation, haversine,

    // bonus/public API
    initBonusesFromRules,
    getNextBonus,
    getClaimableBonus,
    claimBonus,
    getLocations,
    syncTriggeredFromServer,
    allPlannedBonuses,
    claimedList,
  }
})
