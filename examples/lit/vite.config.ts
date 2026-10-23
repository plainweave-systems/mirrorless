// Copyright 2026 Plainweave Systems. SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vite'

export default defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:4000' } },
})
