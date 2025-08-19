// src/stores/game.js
import { defineStore } from 'pinia'
import axios from 'axios'
import { useSessionStore } from './session' // ← pour récupérer le token

const API = 'https://hidenseek.infrason.ch/api/api.php'

function parseMaybeJSON(data) {
  if (typeof data === 'string') {
    try { return JSON.parse(data) } catch { return { raw: data } }
  }
  return data
}

// ajoute les bons headers (JSON + Authorization si token)
function headers() {
  const session = useSessionStore()
  const h = { 'Content-Type': 'application/json' }
  if (session.token) h.Authorization = `Bearer ${session.token}`
  return h
}

export const useGameStore = defineStore('game', () => {
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
    if (res.status !== 200) throw new Error(data?.error || `get_players_http_${res.status}`)
    return data // { players: [...] }
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

  // optionnel si tu veux garder le concept d’équipe A/B
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

  return { createGame, joinGame, getPlayers, setRole, setTeam }
})
