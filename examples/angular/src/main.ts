// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import { bootstrapApplication } from '@angular/platform-browser'
import { provideMirrorless } from 'mirrorless/angular'
import { createTaskRuntime } from '../../shared/task-api.js'
import { AppComponent } from './app.component'

const runtime = createTaskRuntime()

bootstrapApplication(AppComponent, {
  providers: [provideMirrorless(runtime)],
}).then((app) => {
  app.onDestroy(() => runtime.dispose())
}).catch((error: unknown) => {
  runtime.dispose()
  console.error('Unable to start the Mirrorless Angular example', error)
})
