import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: { dedupe: ['vue'] },
  server: {
    proxy: { '/api': 'http://127.0.0.1:4000' },
  },
})
