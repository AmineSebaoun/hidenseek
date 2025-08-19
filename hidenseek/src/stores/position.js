import { ref } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'
import { useSessionStore } from './session'


const API = 'https://hidenseek.infrason.ch/api/api.php'


export const usePositionStore = defineStore('position', () => {
  const session = useSessionStore()
  const positions = ref([])
  const error = ref(null)


  async function sendPosition(lat, lng) {
    try {
      await axios.post(API, {
        action: 'send_position',
        token: session.token,
        lat,
        lng
      })
    } catch (e) {
      error.value = 'Erreur position'
    }
  }


  async function fetchPositions() {
    try {
      const res = await axios.post(API, {
        action: 'get_positions',
        token: session.token
      })
      positions.value = res.data
    } catch (e) {
      error.value = 'Erreur positions'
    }
  }


  return { positions, error, sendPosition, fetchPositions }
})
