import { defineStore } from 'pinia'
import axios from 'axios'
import { useSessionStore } from './session'

const API = 'https://hidenseek.infrason.ch/api/api.php'

function headers () {
  const s = useSessionStore()
  const h = { 'Content-Type': 'application/json' }
  if (s.token) h.Authorization = `Bearer ${s.token}`
  return h
}

export const useRulesStore = defineStore('rules', {
  state: () => ({
    rules: [],   // [{ time: number, type: 'reveal'|'bonus'|'end' }, ...]
    loading: false,
    error: null
  }),
  actions: {
    async fetchRules () {
      const s = useSessionStore()
      this.loading = true; this.error = null
      try {
        const { data } = await axios.post(API, { action: 'get_rules', game_id: s.game.id }, { headers: headers() })
        this.rules = Array.isArray(data?.rules) ? data.rules : []
      } catch (e) {
        this.error = e?.message || 'fetch_rules_failed'
      } finally {
        this.loading = false
      }
    },
    async saveRules () {
      const s = useSessionStore()
      await axios.post(API, { action: 'save_rules', game_id: s.game.id, rules: this.rules }, { headers: headers() })
    },
    addRule (rule) { this.rules.push(rule) },
    removeRule (i) { this.rules.splice(i, 1) },
    setRules (arr) { this.rules = Array.isArray(arr) ? arr : [] }
  }
})
