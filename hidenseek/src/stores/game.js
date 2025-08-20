// src/stores/game.js
import { defineStore } from 'pinia'
import { ref } from 'vue'                 // 👈 manquait !
import axios from 'axios'
import { useSessionStore } from './session'
import Swal from 'sweetalert2'
import 'sweetalert2/dist/sweetalert2.min.css'

const API = 'https://hidenseek.infrason.ch/api/api.php'

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

export const useGameStore = defineStore('game', () => {
  // --- état d’éviction global ---
  const kicked = ref(false)
  const kickedReason = ref(null)

  async function handleKicked(reason = 'invalid_token') {
    if (kicked.value) return
    kicked.value = true
    kickedReason.value = reason

    try {
      await Swal.fire({
        icon: 'warning',
        title: 'Vous avez été retiré de la partie',
        text: 'Vous allez être redirigé vers l’accueil.',
        confirmButtonText: 'OK'
      })
    } catch {}

    const session = useSessionStore()
    session.token = null
    session.player = null
    session.game = null

    try { window.dispatchEvent(new CustomEvent('hidenseek:kicked', { detail: { reason } })) } catch {}
  }

  async function createGame(name) {
    const res = await axios.post(
      API,
      { action: 'create_game', name },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)
    if (res.status !== 200) throw new Error(data?.error || `create_game_http_${res.status}`)
    if (!data?.game) throw new Error('create_game_bad_payload')
    return data
  }

  async function joinGame({ code, name, role = 'hider' }) {
    const res = await axios.post(
      API,
      { action: 'join_game', code, name, role },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)
    if (res.status !== 200) throw new Error(data?.error || `join_game_http_${res.status}`)
    return data // { player, token, game }
  }

  async function getPlayers() {
    const res = await axios.post(
      API,
      { action: 'get_players' },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)

    if (res.status === 401 || data?.error === 'invalid_token' || data?.error === 'auth_required') {
      await handleKicked(data?.error || `get_players_http_${res.status}`)
      throw new Error('kicked')
    }

    if (res.status !== 200) throw new Error(data?.error || `get_players_http_${res.status}`)
    return data
  }

  async function setRole(playerId, role) {
    const res = await axios.post(
      API,
      { action: 'set_role', player_id: playerId, role },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)

    if (res.status === 401 || data?.error === 'invalid_token' || data?.error === 'auth_required') {
      await handleKicked(data?.error || `set_role_http_${res.status}`)
      throw new Error('kicked')
    }

    if (res.status !== 200) throw new Error(data?.error || `set_role_http_${res.status}`)
    return data
  }

  // optionnel
  async function setTeam(playerId, team) {
    const res = await axios.post(
      API,
      { action: 'set_team', player_id: playerId, team },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)
    if (res.status !== 200) throw new Error(data?.error || `set_team_http_${res.status}`)
    return data
  }

  // ---- ajouts
  async function startGame() {
    const res = await axios.post(
      API,
      { action: 'start_game' },
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)

    if (res.status === 401 || data?.error === 'invalid_token' || data?.error === 'auth_required') {
      await handleKicked(data?.error || `start_game_http_${res.status}`)
      throw new Error('kicked')
    }

    if (res.status !== 200) throw new Error(data?.error || `start_game_http_${res.status}`)
    return data
  }

  // quitter / virer
  async function removePlayer(playerId = null) {
    const payload = { action: 'remove_player' }
    if (playerId) payload.player_id = playerId

    const res = await axios.post(
      API,
      payload,
      { headers: headers(), validateStatus: s => s < 500 }
    )
    const data = parseMaybeJSON(res.data)

    if (res.status === 401 || data?.error === 'invalid_token' || data?.error === 'auth_required') {
      await handleKicked(data?.error || `remove_player_http_${res.status}`)
      throw new Error('kicked')
    }

    if (res.status !== 200) throw new Error(data?.error || `remove_player_http_${res.status}`)
    return data // { ok: true, removed: "player_xxx" }
  }

  return {
    createGame,
    joinGame,
    getPlayers,
    setRole,
    setTeam,
    startGame,
    removePlayer,

    // observables
    kicked,
    kickedReason,
  }
})
