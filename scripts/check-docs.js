// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const files = []
function visit(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.angular', '.git', '.jj', '__pycache__'].includes(item.name)) continue
    const path = resolve(directory, item.name)
    if (item.isDirectory()) visit(path)
    else if (item.name.endsWith('.md')) files.push(path)
  }
}
for (const name of ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md']) {
  const path = resolve(root, name)
  if (existsSync(path)) files.push(path)
}
for (const directory of ['docs', 'examples']) {
  const path = resolve(root, directory)
  if (existsSync(path)) visit(path)
}
const failures = []
for (const file of files) {
  const text = readFileSync(file, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '')
  for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const url = match[1].replace(/^<|>$/g, '')
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(url)) continue
    const path = decodeURIComponent(url.split(/[?#]/, 1)[0])
    if (!path) continue
    const target = resolve(dirname(file), path)
    if (!existsSync(target) || (!statSync(target).isFile() && !statSync(target).isDirectory())) {
      failures.push(`${relative(root, file)} -> ${url}`)
    }
  }
}
if (failures.length) {
  console.error(`Broken local documentation links:\n${failures.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`Local links verified in ${files.length} Markdown files (external URLs and heading anchors not checked).`)
}
