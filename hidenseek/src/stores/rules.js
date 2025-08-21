// src/stores/rules.js
import { defineStore } from 'pinia'
import axios from 'axios'
import { useSessionStore } from './session'

const API = 'https://hidenseek.infrason.ch/api/api.php'
const LAST_FRISE_KEY = 'hns_last_frise_v1' // ⬅️ mémoire locale (durée + timeline)

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
    _catalogKeys: (s) => new Set((s.catalog || []).map(b => b.key)),
  },

  actions: {
    /* =========================
       🔄 Récupération des règles
       ========================= */
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

        // Mappe les bonus de la game -> timeline locale
        this.timeline = (data.bonuses || [])
          .filter(b => b.key)
          .map(b => ({
            id: b.id,                                 // id DB (pour delete_bonus)
            type: b.key,
            time: Number(b.start_ts || 0),            // ici on garde le "temps (s)" comme avant
            duration_sec: Number(b.override_duration_sec || 0),
          }))

        // ➜ Sauvegarde en mémoire locale (durée + frise)
        this._rememberLastFrise()
      } finally {
        this.loading = false
      }
    },

    /* ==========================
       🔄 Récupération du catalogue
       ========================== */
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

    /* ============================
       💾 Sauvegarde complète à l’API
       ============================ */
    async saveRules({ maxDurationSec, scheduledStartTs }) {
      // Formate la frise (hors 'end') -> payload API
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
          replace_bonuses: true, // remplace l’existant pour éviter les doublons
        },
        { headers: headers(), validateStatus: s => s < 500 }
      )

      const data = parseMaybeJSON(res.data)
      if (res.status !== 200) throw new Error(data?.error || `set_rules_http_${res.status}`)

      // Recharge depuis serveur (et re-mémorise local)
      await this.fetchRules()
      return data
    },

    /* ====================================
       ➕ ➖ Mutations locales de la "frise"
       ==================================== */
    addEvent(type, time, durationSec = 0) {
      if (!type || type === 'end') return
      this.timeline.push({ type, time: Number(time) || 0, duration_sec: Number(durationSec) || 0 })
      this._rememberLastFrise()
    },

    async removeEventAt(index) {
      const item = this.timeline[index]
      if (!item) return

      if (item.id) {
        // a un id => supprime côté API
        try {
          await this.deleteBonusById(item.id)
        } catch (e) {
          console.error('deleteBonusById failed', e)
          // fallback local si l’API échoue
          this.timeline.splice(index, 1)
        }
      } else {
        this.timeline.splice(index, 1)
      }
      this._rememberLastFrise()
    },

    async deleteBonusById(bonusId) {
      const res = await axios.post(
        API,
        { action: 'delete_bonus', id: bonusId },
        { headers: headers(), validateStatus: s => s < 500 }
      )
      const data = parseMaybeJSON(res.data)
      if (res.status !== 200) throw new Error(data?.error || `delete_bonus_http_${res.status}`)

      this.timeline = this.timeline.filter(ev => ev.id !== bonusId)
      this._rememberLastFrise()
      return data
    },

    setEnd(time) {
      if (!this.game) this.game = {}
      this.game.max_duration_sec = Number(time) || 0
      this._rememberLastFrise()
    },

    /* ==================================
       🧠 Mémoire locale de la dernière frise
       ================================== */
    _rememberLastFrise() {
      try {
        const serialized = {
          max_duration_sec: Math.max(0, Number(this.game?.max_duration_sec || 0)),
          // on ne stocke pas 'end' (c’est la durée max)
          timeline: (this.timeline || [])
            .filter(ev => ev && ev.type && ev.type !== 'end')
            .map(ev => ({
              type: String(ev.type),
              time: Math.max(0, Number(ev.time || 0)),
              duration_sec: Math.max(0, Number(ev.duration_sec || 0)),
            })),
        }
        localStorage.setItem(LAST_FRISE_KEY, JSON.stringify(serialized))
      } catch {}
    },

    _readLastFrise() {
      try {
        const raw = localStorage.getItem(LAST_FRISE_KEY)
        if (!raw) return null
        const j = JSON.parse(raw)
        if (!j || typeof j !== 'object') return null
        const max = Math.max(0, Number(j.max_duration_sec || 0))
        const tl = Array.isArray(j.timeline) ? j.timeline : []
        return {
          max_duration_sec: max,
          timeline: tl
            .filter(x => x && x.type)
            .map(x => ({
              type: String(x.type),
              time: Math.max(0, Number(x.time || 0)),
              duration_sec: Math.max(0, Number(x.duration_sec || 0)),
            })),
        }
      } catch { return null }
    },

    /**
     * Pré-remplit depuis la dernière frise mémorisée
     * UNIQUEMENT si la game n’a rien défini (durée=0 ET timeline vide).
     * Utile à l’ouverture de la modale d’une game toute neuve.
     */
    prefillFromLastIfEmpty() {
      const last = this._readLastFrise()
      if (!last) return false

      const hasDuration = Number(this.game?.max_duration_sec || 0) > 0
      const hasEvents   = (this.timeline || []).length > 0
      if (hasDuration || hasEvents) return false

      // Filtre les types non présents dans le catalogue actuel
      const valid = last.timeline.filter(ev => this._catalogKeys.has(ev.type))

      // Applique localement
      if (!this.game) this.game = {}
      this.game.max_duration_sec = last.max_duration_sec || 0
      this.timeline = valid

      return true
    },
  },
})
