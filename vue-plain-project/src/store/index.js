import { createStore } from 'vuex'
import app from '@/store/modules/app.js'

const store = createStore({
  modules: {
    app,
  },
})

export default store
