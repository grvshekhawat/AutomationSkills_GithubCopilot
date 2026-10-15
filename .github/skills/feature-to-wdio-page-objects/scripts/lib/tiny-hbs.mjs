/**
 * Minimal Handlebars-like subset: {{var}}, {{#each getters}}...{{/each}}, {{{raw}}}
 * Avoids an npm dependency inside the skill package.
 */

/**
 * @param {string} template
 */
function compile(template) {
  return function render(data) {
    let out = template

    // each blocks
    out = out.replace(
      /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (_, key, block) => {
        const list = data[key] || []
        return list
          .map((item) => {
            let b = block
            b = b.replace(/\{\{\{([^}]+)\}\}\}/g, (__, path) =>
              String(lookup(item, data, path.trim()) ?? '')
            )
            b = b.replace(/\{\{([^}#/]+)\}\}/g, (__, path) =>
              escapeHtml(String(lookup(item, data, path.trim()) ?? ''))
            )
            return b
          })
          .join('')
      }
    )

    out = out.replace(/\{\{\{([^}]+)\}\}\}/g, (_, path) =>
      String(lookup(data, data, path.trim()) ?? '')
    )
    out = out.replace(/\{\{([^}#/]+)\}\}/g, (_, path) =>
      escapeHtml(String(lookup(data, data, path.trim()) ?? ''))
    )

    return out
  }
}

/**
 * @param {object} local
 * @param {object} root
 * @param {string} path
 */
function lookup(local, root, path) {
  if (path.startsWith('this.')) path = path.slice(5)
  if (path === 'this') return local
  const parts = path.split('.')
  let cur = local
  for (const p of parts) {
    if (cur == null) return root[path]
    cur = cur[p]
  }
  return cur
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  // For TS source templates we do not HTML-escape quotes — return as-is
  return s
}

export default { compile }
