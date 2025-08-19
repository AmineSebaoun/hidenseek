import { ref } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'
import { useSessionStore } from './session'


const API = 'https://hidenseek.infrason.ch/api/api.php'


export const useMessageStore = defineStore('message', () => {
  const session = useSessionStore()
  const messages = ref([])
  const loading = ref(false)
  const error = ref(null)


  async function fetchMessages() {
    loading.value = true
    try {
      const res = await axios.post(API, {
        action: 'get_messages',
        token: session.token
      })
      messages.value = res.data
    } catch (e) {
      error.value = 'Erreur chargement messages'
    } finally {
      loading.value = false
    }
  }


  async function sendMessage(content) {
    try {
      await axios.post(API, {
        action: 'send_message',
        token: session.token,
        content
      })
    } catch (e) {
      error.value = 'Erreur envoi message'
    }
  }


  return { messages, loading, error, fetchMessages, sendMessage }
})
