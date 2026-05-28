/**
 * Console diagnostic for CSS custom-property / theme-cascade bugs.
 *
 * Usage in Chrome devtools console:
 *   1. inspect the misbehaving element so it becomes $0
 *   2. paste this whole file into console
 *   3. call: debugCssVar($0, 'background-color', '#b4ff05')
 *
 * The function prints:
 *   - actual vs expected (normalized to rgb)
 *   - ancestor chain (to spot teleport / portal issues)
 *   - matching CSS rules for the property
 *   - recursive var() chain trace, showing for each variable:
 *     · the source rule(s) that declare it (with selector + value)
 *     · its resolved value at consumer / body / html
 *     · whether it's "themed" (body !== html) or "frozen" (all same)
 *   - heuristic suggestion at the bottom
 *
 * Notes:
 *   - findVarSource() walks CSSOM, may skip cross-origin stylesheets
 *   - source rules are listed in document order, NOT specificity-sorted —
 *     the cascade winner is usually the later rule, but inspect for sure
 *   - recursion uses a visited set so cycles are stopped after first visit
 */

function debugCssVar(el, property, expected) {
  if (!el || typeof el.matches !== 'function') {
    console.error('debugCssVar: first arg must be a DOM Element')
    return
  }

  const html = document.documentElement
  const body = document.body
  const cs = getComputedStyle(el)
  const actual = cs.getPropertyValue(property).trim()

  // ── 0. actual vs expected (normalize via temp element so #hex/rgb()/var() all
  //       coerce to canonical rgb)
  const toRgb = c => {
    if (!c) return ''
    const tmp = document.createElement('span')
    tmp.style.color = c
    body.appendChild(tmp)
    const out = getComputedStyle(tmp).color
    tmp.remove()
    return out
  }
  const matches = toRgb(actual) === toRgb(expected)

  console.group(`🔍 debugCssVar — ${property}`)
  console.log('Element:', el)
  console.log('Expected:', expected, '→', toRgb(expected))
  console.log('Actual:  ', actual, '→', toRgb(actual))
  console.log(
    matches ? '%c✓ MATCH' : '%c✗ MISMATCH',
    `color: ${matches ? 'green' : 'red'}; font-weight: bold`
  )

  if (matches) {
    console.groupEnd()
    return
  }

  // ── 1. ancestor chain (spot teleport / portal cases)
  console.group('🌳 Ancestor chain (consumer → root)')
  const chain = []
  for (let cur = el; cur; cur = cur.parentElement) {
    const tag = cur.tagName.toLowerCase()
    const cls = cur.className?.toString().trim()
      ? '.' + cur.className.toString().split(/\s+/).join('.')
      : ''
    chain.push(tag + cls)
  }
  chain.forEach(c => console.log(' ', c))
  const inThemeNight = chain.some(c => c.includes('theme-night'))
  console.log(
    inThemeNight
      ? '✓ found .theme-night in ancestry'
      : '✗ no .theme-night in ancestry — possible teleport / portal'
  )
  console.groupEnd()

  // ── 2. CSS rules that set the property on this element
  console.group('📜 Matching CSS rules for property')
  const propSources = findMatchingRules(el, property)
  if (propSources.length === 0) {
    console.log('No matching rule via CSSOM. Possible: inline style, cross-origin sheet, scoped CSS edge case, or property not actually set.')
  } else {
    propSources.forEach(r =>
      console.log(`  ${r.selectorText} { ${property}: ${r.value}; }`)
    )
  }
  console.groupEnd()

  // ── 3. recursive var() chain
  console.group('🔗 var() chain (deep trace)')
  const sourceValue = propSources.at(-1)?.value ?? actual
  const seedVars = [...new Set(sourceValue.match(/--[\w-]+/g) || [])]
  if (seedVars.length === 0) {
    console.log('No CSS variables in the source. Bug is not a token chain issue.')
  } else {
    const visited = new Set()
    for (const v of seedVars) traceVarChain(el, v, 0, visited)
  }
  console.groupEnd()

  // ── 4. heuristic hypothesis
  console.group('💡 Hypothesis')
  printHypothesis(el, seedVars, inThemeNight)
  console.groupEnd()

  console.groupEnd()
}

/**
 * Recursively trace a custom property: show its source rules, its resolved
 * values at consumer/body/html, then recurse into any inner var() refs.
 */
function traceVarChain(el, varName, indent, visited) {
  const pad = '  '.repeat(indent)

  if (visited.has(varName)) {
    console.log(`${pad}${varName}  🔄 already shown above`)
    return
  }
  visited.add(varName)

  const cs = getComputedStyle(el)
  const atConsumer = cs.getPropertyValue(varName).trim()
  const atBody = getComputedStyle(document.body).getPropertyValue(varName).trim()
  const atHtml = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()

  const themed = atBody !== '' && atHtml !== '' && atBody !== atHtml
  const frozen = atConsumer !== '' && atConsumer === atBody && atBody === atHtml

  // Tag: 🌗 themed (varies across scopes), ❄ frozen (same everywhere)
  const tag = themed ? '🌗' : frozen ? '❄' : ' '
  console.group(`${pad}${tag} ${varName}`)
  console.log(`resolved: consumer=${atConsumer}  body=${atBody}  html=${atHtml}`)

  const sources = findVarSource(el, varName)
  if (sources.length === 0) {
    console.log('(no matching CSSOM rule found for this var)')
  } else {
    console.log('source rules:')
    sources.forEach(s => console.log(`  ${s.selectorText} = ${s.value}`))
  }

  // collect inner var refs from all source rules and recurse
  const inner = new Set()
  sources.forEach(s => {
    ;(s.value.match(/--[\w-]+/g) || []).forEach(v => {
      if (v !== varName) inner.add(v)
    })
  })
  for (const v of inner) traceVarChain(el, v, indent + 1, visited)

  console.groupEnd()
}

function printHypothesis(el, seedVars, inThemeNight) {
  if (!inThemeNight) {
    console.log('Element is outside .theme-night ancestry → portal/teleport.')
    console.log('🔧 Fix: trace where this element is mounted. If it is a dialog/modal that was teleported, make sure the teleport target stays inside body.theme-night, or apply .theme-night on the portal root.')
    return
  }

  // Scan resolved values for each seed var at body/html to find the
  // first var that's "frozen" (same across scopes) — that's usually the
  // culprit of eager-substitution
  let frozenSuspect = null
  let themedFoundNearby = null
  for (const v of seedVars) {
    const atBody = getComputedStyle(document.body).getPropertyValue(v).trim()
    const atHtml = getComputedStyle(document.documentElement).getPropertyValue(v).trim()
    if (atBody === atHtml && atHtml !== '') {
      frozenSuspect = { name: v, value: atHtml }
      // try to find a related themed var in the source of this var
      const sources = findVarSource(el, v)
      const innerVars = new Set()
      sources.forEach(s => {
        ;(s.value.match(/--[\w-]+/g) || []).forEach(x => innerVars.add(x))
      })
      for (const iv of innerVars) {
        const ivBody = getComputedStyle(document.body).getPropertyValue(iv).trim()
        const ivHtml = getComputedStyle(document.documentElement).getPropertyValue(iv).trim()
        if (ivBody !== ivHtml && ivHtml !== '') {
          themedFoundNearby = { name: iv, body: ivBody, html: ivHtml }
          break
        }
      }
      if (themedFoundNearby) break
    }
  }

  if (frozenSuspect && themedFoundNearby) {
    console.warn(
      `Probable EAGER SUBSTITUTION:\n` +
      `  ${frozenSuspect.name} is frozen at ${frozenSuspect.value} (same on element/body/html),\n` +
      `  but it references ${themedFoundNearby.name} which IS themed\n` +
      `  (body=${themedFoundNearby.body}, html=${themedFoundNearby.html}).\n\n` +
      `In CSS, var() inside a custom-property assignment is resolved at the\n` +
      `declaring scope (eager). ${frozenSuspect.name} is declared only at :root,\n` +
      `so its inner var() was substituted using html-scope values and frozen.\n` +
      `Body's own update of the inner var doesn't reach it.\n\n` +
      `🔧 Fix: re-declare ${frozenSuspect.name} inside :root .theme-night so the\n` +
      `   inner var() gets re-substituted at body level. In this codebase that\n` +
      `   typically means adding the parent-set call to dark theme too:\n\n` +
      `     .theme() {\n` +
      `       /* ... */\n` +
      `       .generate-color-mixin(.parent-set());\n` +
      `       /* ... */\n` +
      `       .generate-dark-color-mixin(.parent-set());   // 🆕 add this\n` +
      `     }\n`
    )
    return
  }

  // No themed var nearby — body might just not be themed at all
  const anyThemed = seedVars.some(v => {
    const b = getComputedStyle(document.body).getPropertyValue(v).trim()
    const h = getComputedStyle(document.documentElement).getPropertyValue(v).trim()
    return b !== h && h !== ''
  })
  if (!anyThemed) {
    console.log('None of the vars in the chain have body-vs-html variance.')
    console.log('Possibilities:')
    console.log(' (a) body lacks .theme-night → check document.body.classList')
    console.log(' (b) dark-theme CSS rules not generated / not loaded')
    console.log('Quick check:')
    console.log('  document.body.classList.contains("theme-night")')
    console.log('  [...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch { return [] }})')
    console.log('    .filter(r => r.selectorText?.includes(".theme-night")).length')
    return
  }

  console.log('Could not classify automatically — inspect the var() chain above.')
  console.log('Things to look for:')
  console.log(' • A ❄ frozen var that references a 🌗 themed var → eager substitution bug.')
  console.log(' • A var with no matching rule → typo in name or not declared.')
  console.log(' • Multiple source rules with same selector but different values → cascade ordering / specificity issue.')
}

/**
 * Walk all stylesheets, collect rules whose selector matches `el` AND whose
 * declaration block sets `property`.
 * Returns: [{ selectorText, value }] in document order.
 */
function findMatchingRules(el, property) {
  const matches = []
  const walk = rules => {
    for (const rule of rules) {
      if (rule.cssRules) walk(rule.cssRules)
      if (rule.type !== 1) continue   // CSSStyleRule only
      let value
      try { value = rule.style.getPropertyValue(property) } catch { continue }
      if (!value) continue
      try {
        if (el.matches(rule.selectorText)) {
          matches.push({ selectorText: rule.selectorText, value: value.trim() })
        }
      } catch { /* unsupported / invalid selector */ }
    }
  }
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules || sheet.rules || []) } catch { /* CORS */ }
  }
  return matches
}

/**
 * Same as findMatchingRules but for a CSS custom property (--foo). Separated
 * for clarity in the recursion path.
 */
function findVarSource(el, varName) {
  return findMatchingRules(el, varName)
}
