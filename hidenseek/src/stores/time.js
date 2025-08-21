import { defineStore } from 'pinia'
import axios from 'axios'
import { useSessionStore } from '@/stores/session'

const API = 'https://hidenseek.infrason.ch/api/api.php'

export const useTimeStore = defineStore('time', {
  state: () => ({ offsetMs: 0, rttMs: 0, _timer: null }),

  actions: {
    async syncOnce () {
      const t0 = performance.now()
      const c0 = Date.now()
      const res = await axios.post(API, { action: 'health' }, {
        headers: this._headers(), validateStatus: s => s < 500
      })
      const t1 = performance.now()
      const c1 = Date.now()
      if (res.status !== 200 || typeof res.data?.time === 'undefined') throw new Error('health_failed')

      const serverMs = Number(res.data.time) * 1000
      const clientMid = (c0 + c1) / 2
      this.offsetMs = serverMs - clientMid
      this.rttMs = t1 - t0
    },

    start (intervalMs = 15000) {
      this.syncOnce().catch(() => {})
      if (this._timer) clearInterval(this._timer)
      this._timer = setInterval(() => this.syncOnce().catch(() => {}), Math.max(5000, intervalMs))
    },

    stop () { if (this._timer) clearInterval(this._timer); this._timer = null },
    nowServerMs () { return Date.now() + this.offsetMs },

    _headers () {
      const s = useSessionStore()
      const h = { 'Content-Type': 'application/json' }
      if (s.token) h.Authorization = `Bearer ${s.token}`
      return h
    }
  }
})
