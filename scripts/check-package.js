// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(packageJson.license, 'Apache-2.0')
assert.equal(packageJson.author, 'Plainweave Systems')
assert.equal(packageJson.dependencies, undefined, 'The core must have no runtime package dependencies')
for (const [name, target] of Object.entries(packageJson.exports)) {
  if (typeof target === 'string') {
    assert.ok(existsSync(new URL(`../${target}`, import.meta.url)), `Missing export ${name}: ${target}`)
    continue
  }
  for (const path of Object.values(target)) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `Missing export ${name}: ${path}`)
  }
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const [packed] = JSON.parse(execFileSync(npm, ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' }))
const paths = packed.files.map(file => file.path)
for (const required of ['LICENSE', 'NOTICE', 'README.md', 'src/core/index.js', 'src/core/index.d.ts']) {
  assert.ok(paths.includes(required), `Package omits ${required}`)
}
const unwanted = paths.filter(path => /(^|\/)(node_modules|dist|\.jj|\.git|\.angular|__pycache__)(\/|$)|(^|\/)\.env(?:\.|$)|\.pyc$|\.tsbuildinfo$/.test(path))
assert.deepEqual(unwanted, [], 'Package must not include dependencies, generated builds, VCS state, or environment files')
console.log(`Package verified: ${packed.entryCount} source/documentation files, ${packed.size} packed bytes; all exports present.`)
