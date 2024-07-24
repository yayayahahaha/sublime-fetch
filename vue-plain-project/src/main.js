import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import store from '@/store/index.js'
import router from '@/router/index.js'
import 'virtual:windi.css'
import openDialogPlugin from '@/plugins/openDialog.js'

const app = createApp(App)

app.use(store).use(router).use(openDialogPlugin)

app.mount('#app')
