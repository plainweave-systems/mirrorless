import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import preact from '@preact/preset-vite'
import vue from '@vitejs/plugin-vue'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import solid from 'vite-plugin-solid'

const browserTest = (name, extra = {}) => ({
  ...extra,
  test: {
    name,
    environment: 'jsdom',
    include: [`tests/frameworks/${name}*.test.{js,jsx,ts,tsx}`],
    restoreMocks: true,
    ...extra.test,
  },
})

export default defineConfig({
  test: {
    projects: [
      browserTest('react', { plugins: [react()] }),
      browserTest('preact', { plugins: [preact()] }),
      browserTest('vue', { plugins: [vue()] }),
      browserTest('svelte', {
        plugins: [svelte({ compilerOptions: { hmr: false } })],
        resolve: { conditions: ['browser', 'development'] },
        test: { server: { deps: { inline: ['svelte'] } } },
      }),
      browserTest('solid', {
        plugins: [solid()],
        resolve: { conditions: ['browser', 'development'] },
        test: { server: { deps: { inline: ['solid-js'] } } },
      }),
      browserTest('angular'),
      browserTest('lit'),
    ],
  },
})
