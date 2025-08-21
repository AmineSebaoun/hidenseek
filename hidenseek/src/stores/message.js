import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'
import { useSessionStore } from './session'

const API = 'https://hidenseek.infrason.ch/api/api.php'
const POLL_MS = 1500
const MAX_MSG = 300

export const useMessageStore = defineStore('message', () => {
  const session  = useSessionStore()

  const messages = ref([])         // [{id, player_id, author, type, content, created_at, mine, timeLabel}]
  const loading  = ref(false)
  const error    = ref(null)
  const lastId   = ref(0)
  const pollId   = ref(null)
  const busyPoll = ref(false)

  function hydrate(row){
    const mine = !!(row.player_id && session.player?.id === row.player_id)
    return {
      id: Number(row.id ?? 0),
      player_id: row.player_id || null,
      author: row.author || (mine ? 'Moi' : 'Joueur'),
      type: row.type || 'text',
      content: String(row.content ?? ''),
      created_at: Number(row.created_at || 0),
      mine,
      timeLabel: new Date((Number(row.created_at) || 0) * 1000).toLocaleTimeString().slice(0,5),
    }
  }

  function reconcilePush(list){
    if (!Array.isArray(list) || !list.length) return
    for (const r of list) {
      const m = hydrate(r)
      // remplace un message optimiste si même contenu (image ou texte) et mine et id temp
      const idxTemp = messages.value.findIndex(x =>
        String(x.id).startsWith('tmp_') && x.mine && x.type === m.type && x.content === m.content
      )
      if (idxTemp !== -1) {
        messages.value.splice(idxTemp, 1, m)
      } else if (!messages.value.some(x => x.id === m.id && m.id !== 0)) {
        messages.value.push(m)
      }
      if (m.id) lastId.value = Math.max(lastId.value, m.id)
    }
    if (messages.value.length > MAX_MSG) {
      messages.value.splice(0, messages.value.length - MAX_MSG)
    }
  }

  async function fetchInitial(limit = 100){
    if (!session.token) return
    loading.value = true
    error.value   = null
    try {
      const res = await axios.post(API, {
        action: 'get_messages',
        token: session.token,
        limit
      })
      const list = res?.data?.messages || []
      messages.value = []
      lastId.value   = 0
      reconcilePush(list)
    } catch (e) {
      error.value = 'Erreur chargement messages'
    } finally {
      loading.value = false
    }
  }

  async function fetchSince(){
    if (busyPoll.value || !session.token) return
    busyPoll.value = true
    try {
      const res = await axios.post(API, {
        action: 'get_messages',
        token: session.token,
        after_id: lastId.value,
        limit: 150
      })
      reconcilePush(res?.data?.messages || [])
    } catch (e) {
      // silencieux
    } finally {
      busyPoll.value = false
    }
  }

  async function sendMessage(content){
    if (!content || !session.token) return
    const temp = {
      id: 'tmp_' + Math.random().toString(36).slice(2),
      player_id: session.player?.id || null,
      author: session.player?.name || 'Moi',
      type: 'text',
      content: String(content),
      created_at: Math.floor(Date.now()/1000),
      mine: true,
      timeLabel: new Date().toLocaleTimeString().slice(0,5),
    }
    messages.value.push(temp)
    try {
      const res = await axios.post(API, { action: 'send_message', token: session.token, content })
      const msg = res?.data?.message
      if (msg?.id) reconcilePush([msg]); else await fetchSince()
    } catch (e) {
      const i = messages.value.findIndex(m => m.id === temp.id)
      if (i !== -1) messages.value[i] = { ...messages.value[i], failed: true }
      error.value = 'Erreur envoi message'
    }
  }

  async function sendImage(dataUrl){
    if (!dataUrl || !session.token) return
    const temp = {
      id: 'tmp_' + Math.random().toString(36).slice(2),
      player_id: session.player?.id || null,
      author: session.player?.name || 'Moi',
      type: 'image',
      content: dataUrl, // preview locale
      created_at: Math.floor(Date.now()/1000),
      mine: true,
      timeLabel: new Date().toLocaleTimeString().slice(0,5),
    }
    messages.value.push(temp)
    try {
      const res = await axios.post(API, { action: 'send_image', token: session.token, data_url: dataUrl })
      const msg = res?.data?.message
      if (msg?.id) reconcilePush([msg]); else await fetchSince()
    } catch (e) {
      const i = messages.value.findIndex(m => m.id === temp.id)
      if (i !== -1) messages.value[i] = { ...messages.value[i], failed: true }
      error.value = 'Erreur envoi image'
    }
  }

  function clearAll(){
    messages.value = []
    lastId.value   = 0
    error.value    = null
  }

  async function initPolling(){
    await fetchInitial()
    if (pollId.value) clearInterval(pollId.value)
    pollId.value = setInterval(fetchSince, POLL_MS)
  }

  function stopPolling(){
    if (pollId.value) clearInterval(pollId.value)
    pollId.value = null
  }

  // Helpers sélectifs côté UI
  const lastImage = computed(() => {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].type === 'image') return messages.value[i]
    }
    return null
  })

  return {
    messages, loading, error, lastImage,
    initPolling, stopPolling, clearAll,
    fetchInitial, fetchSince, sendMessage, sendImage
  }
})
