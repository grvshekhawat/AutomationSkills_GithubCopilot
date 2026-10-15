/**
 * Lightweight Gherkin parser for Feature / Scenario / Steps.
 * Does not evaluate tables or docs strings beyond capturing raw step text.
 */

/**
 * @typedef {object} ParsedStep
 * @property {string} keyword - Given|When|Then|And|But
 * @property {string} text - step text without keyword
 * @property {string} raw - full line
 * @property {number} line
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

  const stepRe = /^\s*(Given|When|Then|And|But)\s+(.+?)\s*$/i
  const tagRe = /^\s*(@.+)$/
  const featureRe = /^\s*Feature:\s*(.*)$/i
  const backgroundRe = /^\s*Background:\s*(.*)$/i
  const scenarioRe = /^\s*Scenario(?: Outline)?:\s*(.*)$/i
  const examplesRe = /^\s*Examples:\s*/i

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) continue

    const tagMatch = trimmed.match(tagRe)
    if (tagMatch && !trimmed.includes(' ')) {
      // single or multiple tags on one line
      const tags = trimmed.split(/\s+/).filter((t) => t.startsWith('@'))
      pendingTags.push(...tags)
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
      continue
    }

    const backgroundMatch = line.match(backgroundRe)
    if (backgroundMatch) {
      mode = 'background'
      currentScenario = null
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
      continue
    }

    if (examplesRe.test(line)) {
      mode = 'none'
      currentScenario = null
      continue
    }

    const stepMatch = line.match(stepRe)
    if (stepMatch) {
      const step = {
        keyword: capitalize(stepMatch[1]),
        text: stepMatch[2].trim(),
        raw: trimmed,
        line: lineNum,
      }
      if (mode === 'background') {
        feature.background.push(step)
      } else if (mode === 'scenario' && currentScenario) {
        currentScenario.steps.push(step)
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
