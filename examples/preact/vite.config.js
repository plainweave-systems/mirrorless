import { defineConfig, searchForWorkspaceRoot } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
    proxy: { '/api': 'http://127.0.0.1:4000' },
  },
})
