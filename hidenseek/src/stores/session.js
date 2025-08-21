// src/stores/session.js
import { defineStore } from 'pinia'

const STORAGE_KEY = 'hns_session_v1'

// anciennes clés à migrer/supprimer
const LEGACY = {
  TOKEN_KEYS: ['hs_token', 'auth_token', 'token'],
  PLAYER_KEY: 'hs_player',
  GAME_KEY:   'hs_game',
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    token: null,     // Bearer token
    player: null,    // { id, name, role, ... }
    game: null       // { id, code, name, state, ... }
  }),

  getters: {
    isAuthenticated: (s) => !!s.token,
    gameId: (s) => s.game?.id || null,
  },

  actions: {
    setAuth(token, player, game) {
      this.token = token ?? null
      this.player = player ?? null
      this.game = game ?? null
      this._save()
    },
    setPlayer(partial) {
      this.player = { ...(this.player || {}), ...partial }
      this._save()
    },
    setGame(partial) {
      // passer null pour vider complètement
      if (partial === null) {
        this.game = null
      } else {
        this.game = { ...(this.game || {}), ...partial }
      }
      this._save()
    },
    clearAuth() {
      this.token = null
      this.player = null
      this.game = null
      try { localStorage.removeItem(STORAGE_KEY) } catch {}
    },

    loadFromStorage() {
      try {
        // 1) format courant
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const data = JSON.parse(raw)
          this.token  = data?.token  || null
          this.player = data?.player || null
          this.game   = data?.game   || null
          return
        }

        // 2) migration depuis les anciennes clés
        let token = null
        for (const k of LEGACY.TOKEN_KEYS) {
          const t = localStorage.getItem(k)
          if (t) { token = t; break }
        }
        let player = null, game = null
        try {
          const p = localStorage.getItem(LEGACY.PLAYER_KEY)
          if (p) player = JSON.parse(p)
        } catch {}
        try {
          const g = localStorage.getItem(LEGACY.GAME_KEY)
          if (g) game = JSON.parse(g)
        } catch {}

        if (token || player || game) {
          this.token = token
          this.player = player
          this.game = game
          this._save()
          // nettoyage des anciennes clés
          try {
            for (const k of LEGACY.TOKEN_KEYS) localStorage.removeItem(k)
            localStorage.removeItem(LEGACY.PLAYER_KEY)
            localStorage.removeItem(LEGACY.GAME_KEY)
          } catch {}
          return
        }

        // sinon: rien en storage => session vierge
        this.clearAuth()
      } catch {
        this.clearAuth()
      }
    },

    _save() {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ token: this.token, player: this.player, game: this.game })
        )
      } catch {}
    }
  }
})
