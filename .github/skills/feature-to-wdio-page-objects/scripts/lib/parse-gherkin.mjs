/**
 * Lightweight Gherkin parser for Feature / Scenario / Steps / data tables.
 */

/**
 * @typedef {object} ParsedStep
 * @property {string} keyword - Given|When|Then|And|But
 * @property {string} text - step text without keyword
 * @property {string} raw - full line
 * @property {number} line
 * @property {string[][]} table - raw table rows (cells), empty if none
 * @property {Record<string, string>} tableMap - first data row keyed by headers
 */

/**
 * @typedef {object} ParsedScenario
 * @property {string} name
 * @property {string[]} tags
 * @property {ParsedStep[]} steps
 * @property {number} line
 */

/**
 * @typedef {object} ParsedFeature
 * @property {string} name
 * @property {string[]} tags
 * @property {ParsedStep[]} background
 * @property {ParsedScenario[]} scenarios
 * @property {string} sourcePath
 */

/**
 * @param {string} line
 * @returns {string[]|null}
 */
export function parseTableRow(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim())
}

/**
 * Map header row + data rows. Extra cells fill empty header values
 * (handles `|UserName||Welcome123|` under `|User|Password|`).
 *
 * @param {string[][]} rows
 * @returns {Record<string, string>}
 */
export function tableToMap(rows) {
  if (!rows || rows.length < 2) return {}
  const headers = rows[0]
  const data = rows[1] || []
  /** @type {Record<string, string>} */
  const map = {}
  headers.forEach((h, i) => {
    map[h] = data[i] ?? ''
  })
  const extra = data.slice(headers.length).filter((c) => c !== '')
  for (const h of headers) {
    if ((map[h] == null || map[h] === '') && extra.length) {
      map[h] = extra.shift()
    }
  }
  return map
}

/**
 * @param {string} content
 * @param {string} [sourcePath]
 * @returns {ParsedFeature}
 */
export function parseGherkin(content, sourcePath = '') {
  const lines = String(content).split(/\r?\n/)
  /** @type {ParsedFeature} */
  const feature = {
    name: '',
    tags: [],
    background: [],
    scenarios: [],
    sourcePath,
  }

  /** @type {string[]} */
  let pendingTags = []
  /** @type {'none'|'background'|'scenario'} */
  let mode = 'none'
  /** @type {ParsedScenario|null} */
  let currentScenario = null
  /** @type {ParsedStep|null} */
  let lastStep = null

  const stepRe = /^\s*(Given|When|Then|And|But)\s+(.+?)\s*$/i
  const featureRe = /^\s*Feature:\s*(.*)$/i
  const backgroundRe = /^\s*Background:\s*(.*)$/i
  const scenarioRe = /^\s*Scenario(?: Outline)?:\s*(.*)$/i
  const examplesRe = /^\s*Examples:\s*/i

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) continue

    const tableCells = parseTableRow(line)
    if (tableCells && lastStep && (mode === 'background' || mode === 'scenario')) {
      lastStep.table.push(tableCells)
      lastStep.tableMap = tableToMap(lastStep.table)
      continue
    }

    if (trimmed.startsWith('@')) {
      pendingTags.push(
        ...trimmed.split(/\s+/).filter((t) => t.startsWith('@'))
      )
      continue
    }

    const featureMatch = line.match(featureRe)
    if (featureMatch) {
      feature.name = featureMatch[1].trim()
      feature.tags = pendingTags
      pendingTags = []
      mode = 'none'
      lastStep = null
      continue
    }

    const backgroundMatch = line.match(backgroundRe)
    if (backgroundMatch) {
      mode = 'background'
      currentScenario = null
      lastStep = null
      pendingTags = []
      continue
    }

    const scenarioMatch = line.match(scenarioRe)
    if (scenarioMatch) {
      mode = 'scenario'
      currentScenario = {
        name: scenarioMatch[1].trim(),
        tags: pendingTags,
        steps: [],
        line: lineNum,
      }
      feature.scenarios.push(currentScenario)
      pendingTags = []
      lastStep = null
      continue
    }

    if (examplesRe.test(line)) {
      mode = 'none'
      currentScenario = null
      lastStep = null
      continue
    }

    const stepMatch = line.match(stepRe)
    if (stepMatch) {
      const step = {
        keyword: capitalize(stepMatch[1]),
        text: stepMatch[2].trim(),
        raw: trimmed,
        line: lineNum,
        table: [],
        tableMap: {},
      }
      if (mode === 'background') {
        feature.background.push(step)
        lastStep = step
      } else if (mode === 'scenario' && currentScenario) {
        currentScenario.steps.push(step)
        lastStep = step
      }
      continue
    }
  }

  return feature
}

/**
 * Flatten background + scenario steps for execution.
 * @param {ParsedFeature} feature
 * @param {ParsedScenario} scenario
 */
export function stepsForScenario(feature, scenario) {
  return [...feature.background, ...scenario.steps]
}

/**
 * @param {string} word
 */
function capitalize(word) {
  const w = word.toLowerCase()
  return w.charAt(0).toUpperCase() + w.slice(1)
}
