#!/usr/bin/env node

// 把專案裡的 .vscode/color-scheme.code-snippets 轉換成 sublime text 的 snippet 並輸出到 js 和 style 對應的 json

const fs = require('node:fs')
const path = require('node:path')

const INPUT = path.resolve(__dirname, '.vscode/color-scheme.code-snippets')
const OUTPUT_JS = path.resolve(__dirname, 'sublime-text-snippet-format-js.json')
const OUTPUT_STYLE = path.resolve(__dirname, 'sublime-text-snippet-format-style.json')

const SCOPE_JS = 'source.js meta.function.js meta.block.js meta.mapping.js meta.function-call.arguments.js meta.group.js meta.string.js string.quoted.single.js'
const SCOPE_STYLE = 'text.html.vue source.less.embedded.html meta.property-list.css meta.block.css meta.property-value.css meta.function-call.arguments.css'

const PREFIX_FROM = 'DT-'
const PREFIX_TO = 'ctoken-'

const raw = fs.readFileSync(INPUT, 'utf8')
const snippets = JSON.parse(raw)

const bodyToContents = (body) => {
  const text = Array.isArray(body) ? body.join('\n') : String(body)
  const match = text.match(/var\(\s*(--[^)]+?)\s*\)/)
  if (match) return match[1]
  return text.replace(/;\s*$/, '').trim()
}

const completions = Object.values(snippets).map((entry) => ({
  trigger: entry.prefix.replace(new RegExp(`^${PREFIX_FROM}`), PREFIX_TO),
  contents: bodyToContents(entry.body),
}))

const outputJs = { scope: SCOPE_JS, completions }
const outputStyle = { scope: SCOPE_STYLE, completions }

fs.writeFileSync(OUTPUT_JS, `${JSON.stringify(outputJs, null, 2)}\n`)
fs.writeFileSync(OUTPUT_STYLE, `${JSON.stringify(outputStyle, null, 2)}\n`)

console.log(`Wrote ${completions.length} completions to ${OUTPUT_JS}`)
console.log(`Wrote ${completions.length} completions to ${OUTPUT_STYLE}`)
