// src/stores/rules.js
import { defineStore } from 'pinia'
import axios from 'axios'
import { useSessionStore } from './session'

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

export const useRulesStore = defineStore('rules', {
  state: () => ({
    game: null,
    timeline: [],        // [{ id?, type, time, duration_sec }]
    catalog: [],
    loading: false,
  }),

  getters: {
    maxDurationMinutes: (s) => Math.floor((s.game?.max_duration_sec || 0) / 60),
  },

  actions: {
    // 🔄 Récupération des règles
    async fetchRules(gameId = null) {
      this.loading = true
      try {
        const res = await axios.post(
          API,
          { action: 'get_rules', game_id: gameId },
          { headers: headers(), validateStatus: s => s < 500 }
        )
        const data = parseMaybeJSON(res.data)
        if (res.status !== 200) throw new Error(data?.error || `get_rules_http_${res.status}`)

        this.game = data.game || null

        // ⚠️ On garde l'id de chaque bonus pour pouvoir le supprimer
        this.timeline = (data.bonuses || [])
          .filter(b => b.key) // Bonus valides
          .map(b => ({
            id: b.id,                    // <— ID DB
            type: b.key,
            time: Number(b.start_ts || 0),
            duration_sec: Number(b.override_duration_sec || 0),
          }))
      } finally {
        this.loading = false
      }
    },

    // 🔄 Récupération du catalogue
    async fetchCatalog() {
      this.loading = true
      try {
        const res = await axios.post(
          API,
          { action: 'catalog_get_bonuses' },
          { headers: headers(), validateStatus: s => s < 500 }
        )
        const data = parseMaybeJSON(res.data)
        if (res.status !== 200) throw new Error(data?.error || `catalog_http_${res.status}`)
        this.catalog = data.catalog || []
      } finally {
        this.loading = false
      }
    },

    // 💾 Sauvegarde complète vers l'API
    async saveRules({ maxDurationSec, scheduledStartTs }) {
      // On formate la timeline -> payload API
      const formattedBonuses = this.timeline
        .filter(ev => ev.type !== 'end')
        .map(ev => {
          const bonus = this.catalog.find(b => b.key === ev.type)
          if (!bonus) return null
          return {
            key: bonus.key,
            start_ts: Number(ev.time) || 0,
            override_duration_sec: Number(ev.duration_sec) || 0,
          }
        })
        .filter(Boolean)

      const res = await axios.post(
        API,
        {
          action: 'set_rules',
          max_duration_sec: Number(maxDurationSec || 0),
          scheduled_start_ts: scheduledStartTs ?? null,
          bonuses: formattedBonuses,
          // évite les doublons : on remplace l’existant de la game
          replace_bonuses: true,
        },
        { headers: headers(), validateStatus: s => s < 500 }
      )

      const data = parseMaybeJSON(res.data)
      if (res.status !== 200) throw new Error(data?.error || `set_rules_http_${res.status}`)
      return data
    },

    // ➕ Ajoute un événement bonus (local)
    addEvent(type, time, durationSec = 0) {
      if (!type || type === 'end') return
      this.timeline.push({ type, time: Number(time) || 0, duration_sec: Number(durationSec) || 0 })
    },

    // ❌ Supprime un événement à l'index donné
    async removeEventAt(index) {
      const item = this.timeline[index]
      if (!item) return

      // S'il est en DB (a un id), on appelle l'API, sinon on supprime localement
      if (item.id) {
        try {
          await this.deleteBonusById(item.id)
        } catch (e) {
          console.error('deleteBonusById failed', e)
          // fallback local si l'API échoue
          this.timeline.splice(index, 1)
        }
      } else {
        this.timeline.splice(index, 1)
      }
    },

    // 🗑️ Supprime un bonus côté API par son id (et met à jour la timeline)
    async deleteBonusById(bonusId) {
      const res = await axios.post(
        API,
        { action: 'delete_bonus', id: bonusId },
        { headers: headers(), validateStatus: s => s < 500 }
      )
      const data = parseMaybeJSON(res.data)
      if (res.status !== 200) throw new Error(data?.error || `delete_bonus_http_${res.status}`)

      // Nettoyage local
      this.timeline = this.timeline.filter(ev => ev.id !== bonusId)
      return data
    },

    // 🕒 Définit la durée max (local)
    setEnd(time) {
      if (!this.game) this.game = {}
      this.game.max_duration_sec = Number(time) || 0
    },
  },
})
