import { createApp } from 'vue'
import { createMirrorlessPlugin } from 'mirrorless/vue'
import { createTaskRuntime } from '../shared/task-api.js'
import '../shared/style.css'
import App from './App.vue'

const runtime = createTaskRuntime()
const app = createApp(App)
app.use(createMirrorlessPlugin(runtime))
app.mount('#app')

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.unmount()
    runtime.dispose()
  })
}
