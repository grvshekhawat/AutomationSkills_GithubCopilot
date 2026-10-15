/**
 * Parse and merge WebdriverIO TypeScript page-object getters.
 */

/**
 * @typedef {object} Getter
 * @property {string} name
 * @property {string} selector
 * @property {string} [rawBlock]
 */

const GETTER_RE =
  /get\s+([A-Za-z_][\w]*)\s*\(\s*\)\s*\{\s*return\s+\$\$?\(\s*(['"`])([\s\S]*?)\2\s*\)\s*\}/g

/**
 * @param {string} source
 * @returns {Getter[]}
 */
export function parseGetters(source) {
  /** @type {Getter[]} */
  const getters = []
  const re = new RegExp(GETTER_RE.source, 'g')
  let m
  while ((m = re.exec(source)) !== null) {
    getters.push({
      name: m[1],
      selector: m[3],
      rawBlock: m[0],
    })
  }
  return getters
}

/**
 * @param {string} name
 * @param {string} selector
 * @param {boolean} [multiple=false]
 */
export function formatGetter(name, selector, multiple = false) {
  const fn = multiple ? '$$' : '$'
  const escaped = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `    get ${name} () {\n        return ${fn}('${escaped}')\n    }`
}

/**
 * @param {string} className
 * @param {Getter[]} getters
 * @param {object} [opts]
 * @param {string} [opts.baseImport]
 * @param {string} [opts.baseClass]
 * @param {string} [opts.openPath]
 */
export function renderPageObject(className, getters, opts = {}) {
  const baseImport =
    opts.baseImport ??
    `import { $ } from '@wdio/globals'\nimport Page from './page.js'`
  const baseClass = opts.baseClass ?? 'Page'
  const body = getters.map((g) => formatGetter(g.name, g.selector)).join('\n\n')
  const openPath = opts.openPath

  const openMethod = openPath
    ? `\n\n    open () {\n        return super.open('${openPath.replace(/'/g, "\\'")}')\n    }`
    : ''

  return `${baseImport}

class ${className} extends ${baseClass} {
${body || '    // no locators yet'}${openMethod}
}

export default new ${className}()
`
}

/**
 * Merge new getters into existing page object source.
 * Preserves unused getters. Updates selector when same name differs.
 *
 * @param {string} existingSource
 * @param {Getter[]} incoming
 * @returns {{ source: string, added: string[], updated: string[], unchanged: string[] }}
 */
export function mergeGettersIntoSource(existingSource, incoming) {
  const existing = parseGetters(existingSource)
  const byName = new Map(existing.map((g) => [g.name, g]))
  const added = []
  const updated = []
  const unchanged = []

  for (const g of incoming) {
    const prev = byName.get(g.name)
    if (!prev) {
      byName.set(g.name, g)
      added.push(g.name)
    } else if (prev.selector !== g.selector) {
      byName.set(g.name, { ...prev, selector: g.selector })
      updated.push(g.name)
    } else {
      unchanged.push(g.name)
    }
  }

  const classMatch = existingSource.match(/class\s+([A-Za-z_][\w]*)/)
  const className = classMatch ? classMatch[1] : 'GeneratedPage'
  const exportDefault = /export\s+default\s+new/.test(existingSource)

  // Preserve header imports up to class
  const classIdx = existingSource.search(/class\s+[A-Za-z_]/)
  let header =
    classIdx >= 0
      ? existingSource.slice(0, classIdx).trimEnd()
      : `import { $ } from '@wdio/globals'\nimport Page from './page.js'`

  // Preserve open() if present
  const openMatch = existingSource.match(
    /open\s*\([^)]*\)\s*\{[\s\S]*?return\s+super\.open\((['"`])([\s\S]*?)\1\)[\s\S]*?\}/
  )
  const openPath = openMatch ? openMatch[2] : null

  const allGetters = [...byName.values()]
  const body = allGetters.map((g) => formatGetter(g.name, g.selector)).join('\n\n')
  const openMethod = openPath
    ? `\n\n    open () {\n        return super.open('${openPath.replace(/'/g, "\\'")}')\n    }`
    : openMatch
      ? `\n\n${openMatch[0]}`
      : ''

  // Detect extends
  const extendsMatch = existingSource.match(
    /class\s+[A-Za-z_][\w]*\s+extends\s+([A-Za-z_][\w]*)/
  )
  const baseClass = extendsMatch ? extendsMatch[1] : 'Page'

  const source = `${header}

class ${className} extends ${baseClass} {
${body}${openMethod}
}

${exportDefault ? `export default new ${className}()` : `export { ${className} }`}
`

  return { source, added, updated, unchanged }
}

/**
 * @param {string} pageName - e.g. LoginPage or login
 */
export function toPageClassName(pageName) {
  const cleaned = String(pageName).replace(/\.page$/i, '').replace(/\.ts$/i, '')
  const parts = cleaned.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/)
  const pascal = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
  return pascal.endsWith('Page') ? pascal : `${pascal}Page`
}

/**
 * @param {string} urlPath
 */
export function pageNameFromUrl(urlPath) {
  try {
    const u = urlPath.includes('://')
      ? new URL(urlPath)
      : new URL(urlPath, 'http://local')
    const seg =
      u.pathname
        .split('/')
        .filter(Boolean)
        .pop() || 'home'
    return seg.replace(/\.[^.]+$/, '')
  } catch {
    return 'page'
  }
}
