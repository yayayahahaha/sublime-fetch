#!/usr/bin/env node

// 把專案裡的 .vscode/color-scheme.code-snippets 轉換成 sublime text 的 snippet 並輸出到 sublime-text-snippet-format.json

const fs = require('node:fs')
const path = require('node:path')

const INPUT = path.resolve(__dirname, '.vscode/color-scheme.code-snippets')
const OUTPUT = path.resolve(__dirname, 'sublime-text-snippet-format.json')

const SCOPE = 'meta.function-call.arguments.css'

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

const output = { scope: SCOPE, completions }

fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Wrote ${completions.length} completions to ${OUTPUT}`)
