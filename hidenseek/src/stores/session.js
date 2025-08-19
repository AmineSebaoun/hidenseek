// src/stores/session.js
import { defineStore } from 'pinia'

const STORAGE_KEY = 'hns_session_v1'

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
            this.token = token
            this.player = player
            this.game = game
            this._save()
        },
        setPlayer(partial) {
            this.player = { ...(this.player || {}), ...partial }
            this._save()
        },
        setGame(partial) {
            this.game = { ...(this.game || {}), ...partial }
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
                const raw = localStorage.getItem(STORAGE_KEY)
                if (!raw) return
                const data = JSON.parse(raw)
                this.token = data?.token || null
                this.player = data?.player || null
                this.game = data?.game || null
            } catch {
                this.clearAuth()
            }
        },
        _save() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    token: this.token, player: this.player, game: this.game
                }))
            } catch {}
        }
    }
})
