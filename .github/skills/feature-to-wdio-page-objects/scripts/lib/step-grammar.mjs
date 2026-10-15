/**
 * Map UI-language Cucumber step text → structured actions.
 * Supports quoted and unquoted phrases, login, and data tables.
 */

/**
 * @typedef {'click'|'setValue'|'select'|'clear'|'check'|'navigate'|'assertVisible'|'login'|'observe'|'unknown'} StepAction
 */

/**
 * @typedef {object} ParsedUiStep
 * @property {StepAction} action
 * @property {string|null} target
 * @property {string|null} value
 * @property {string|null} url
 * @property {string} originalText
 * @property {boolean} supported
 * @property {Record<string, string>} tableMap
 * @property {string|null} username
 * @property {string|null} password
 */

const QUOTED = `"([^"]*)"|'([^']*)'`
const STOPWORDS = new Set([
  'i',
  'my',
  'the',
  'a',
  'an',
  'to',
  'and',
  'of',
  'me',
  'please',
  'on',
  'into',
  'in',
])

/**
 * Strip leading "I " / articles and collapse to a useful target phrase.
 * @param {string} phrase
 */
export function normalizeTarget(phrase) {
  const words = String(phrase || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
  return words.join(' ').trim()
}

/**
 * @param {Record<string, string>} map
 * @param {string[]} aliases
 */
export function tableValue(map, aliases) {
  if (!map) return null
  const normalizedAliases = aliases.map((a) => a.toLowerCase().replace(/[^a-z0-9]/g, ''))
  for (const [key, val] of Object.entries(map)) {
    if (val == null || val === '') continue
    const nk = String(key).toLowerCase().replace(/[^a-z0-9]/g, '')
    if (normalizedAliases.some((a) => nk === a || nk.includes(a) || a.includes(nk))) {
      return String(val)
    }
  }
  return null
}

const USER_ALIASES = ['user', 'username', 'userid', 'email', 'login', 'id']
const PASS_ALIASES = ['password', 'pass', 'pwd', 'passwd']
const NAME_ALIASES = ['name', 'fullname', 'firstname', 'lastname']

const VAGUE_OUTCOME =
  /^(this happens|that happens|it works|it is done|success|successful|ok|okay)$/i

/**
 * @param {string} text
 * @param {Record<string, string>} [tableMap]
 * @returns {ParsedUiStep}
 */
export function parseUiStep(text, tableMap = {}) {
  const originalText = text.trim()
  const t = originalText
  const map = tableMap || {}

  /** @type {ParsedUiStep} */
  const base = {
    action: 'unknown',
    target: null,
    value: null,
    url: null,
    originalText,
    supported: false,
    tableMap: map,
    username: tableValue(map, USER_ALIASES),
    password: tableValue(map, PASS_ALIASES),
  }

  // Login (with optional destination + credentials table)
  let m = t.match(
    /^I\s+(?:log\s*in|login|sign\s+in)(?:\s+(?:to|into|as))?\s*(.*)$/i
  )
  if (m) {
    const dest = (m[1] || '').trim()
    const urlish = dest.match(/^(?:https?:\/\/|\/)\S+/i)
    return {
      ...base,
      action: 'login',
      target: dest ? normalizeTarget(dest) || dest : 'login',
      url: urlish ? urlish[0] : null,
      username: base.username,
      password: base.password,
      supported: true,
    }
  }

  // Navigate
  m =
    t.match(
      new RegExp(
        `^I\\s+(?:open|go\\s+to|navigate\\s+to)\\s+(?:the\\s+page\\s+)?(?:${QUOTED}|(\\S+.*))$`,
        'i'
      )
    ) ||
    t.match(
      new RegExp(
        `^I\\s+am\\s+on\\s+(?:the\\s+page\\s+)?(?:${QUOTED}|(\\S+.*))$`,
        'i'
      )
    )
  if (m) {
    const dest = pick(m)
    return {
      ...base,
      action: 'navigate',
      url: dest,
      target: dest,
      supported: true,
    }
  }

  // Click (quoted or unquoted): I click submit / I click the "Save" button
  m = t.match(
    new RegExp(
      `^I\\s+click\\s+(?:on\\s+)?(?:the\\s+)?(?:${QUOTED}|(.+?))(?:\\s+(?:button|link|checkbox|radio|element))?\\s*$`,
      'i'
    )
  )
  if (m) {
    const raw = pick(m)
    return {
      ...base,
      action: 'click',
      target: normalizeTarget(raw) || raw,
      supported: true,
    }
  }

  // Enter value into field (quoted both)
  m = t.match(
    new RegExp(
      `^I\\s+(?:enter|type|fill(?:\\s+in)?|input)\\s+(?:${QUOTED})\\s+(?:into|in)\\s+(?:the\\s+)?(?:${QUOTED})(?:\\s+field)?\\s*$`,
      'i'
    )
  )
  if (m) {
    return {
      ...base,
      action: 'setValue',
      value: firstQuoted(m),
      target: normalizeTarget(secondQuoted(m)) || secondQuoted(m),
      supported: true,
    }
  }

  // I enter "x" into the Email field
  m = t.match(
    new RegExp(
      `^I\\s+(?:enter|type|fill(?:\\s+in)?)\\s+(?:${QUOTED})\\s+into\\s+the\\s+(.+?)\\s+field\\s*$`,
      'i'
    )
  )
  if (m) {
    return {
      ...base,
      action: 'setValue',
      value: pick(m),
      target: normalizeTarget(m[3] || m[2] || '') || (m[3] || m[2] || '').trim(),
      supported: true,
    }
  }

  // I enter my name  / I enter the email  (value from table or later)
  m = t.match(
    /^I\s+(?:enter|type|fill(?:\s+in)?|input)\s+(?:the\s+)?(.+?)(?:\s+field)?\s*$/i
  )
  if (m) {
    const rawTarget = m[1].trim()
    const target = normalizeTarget(rawTarget) || rawTarget
    const value =
      tableValue(map, [target, ...NAME_ALIASES, ...USER_ALIASES]) ||
      tableValue(map, Object.keys(map))
    return {
      ...base,
      action: 'setValue',
      target,
      value,
      supported: true,
    }
  }

  // Select
  m = t.match(
    new RegExp(
      `^I\\s+select\\s+(?:${QUOTED}|(\\S+))\\s+from\\s+(?:the\\s+)?(?:${QUOTED}|(.+?))(?:\\s+dropdown|\\s+select)?\\s*$`,
      'i'
    )
  )
  if (m) {
    return {
      ...base,
      action: 'select',
      value: firstQuoted(m) || m[3] || null,
      target: normalizeTarget(secondQuoted(m) || m[4] || m[5] || '') || pick(m),
      supported: true,
    }
  }

  // Clear
  m = t.match(
    new RegExp(
      `^I\\s+clear\\s+(?:the\\s+)?(?:${QUOTED}|(.+?))(?:\\s+field)?\\s*$`,
      'i'
    )
  )
  if (m) {
    const raw = pick(m)
    return {
      ...base,
      action: 'clear',
      target: normalizeTarget(raw) || raw,
      supported: true,
    }
  }

  // Check / uncheck
  m = t.match(
    new RegExp(
      `^I\\s+(check|uncheck)\\s+(?:the\\s+)?(?:${QUOTED}|(.+?))(?:\\s+checkbox)?\\s*$`,
      'i'
    )
  )
  if (m) {
    const raw = pick(m)
    return {
      ...base,
      action: 'check',
      target: normalizeTarget(raw) || raw,
      value: m[1].toLowerCase() === 'check' ? 'check' : 'uncheck',
      supported: true,
    }
  }

  // Assert visible
  m =
    t.match(
      new RegExp(
        `^I\\s+should\\s+see\\s+(?:the\\s+)?(?:${QUOTED}|(.+?))(?:\\s+(?:message|label|text|element|button|link))?\\s*$`,
        'i'
      )
    ) ||
    t.match(
      new RegExp(
        `^(?:the\\s+)?(?:${QUOTED}|(.+?))\\s+should\\s+be\\s+visible\\s*$`,
        'i'
      )
    )
  if (m) {
    const raw = pick(m)
    const target = normalizeTarget(raw) || raw
    if (VAGUE_OUTCOME.test(target) || VAGUE_OUTCOME.test(raw || '')) {
      return { ...base, action: 'observe', target, supported: true }
    }
    return { ...base, action: 'assertVisible', target, supported: true }
  }

  // Then this happens / outcome-only
  if (VAGUE_OUTCOME.test(normalizeTarget(t) || t) || VAGUE_OUTCOME.test(t)) {
    return { ...base, action: 'observe', target: t, supported: true }
  }

  return base
}

/**
 * @param {RegExpMatchArray} m
 */
function pick(m) {
  for (let i = 1; i < m.length; i++) {
    if (m[i] != null && m[i] !== '') return m[i]
  }
  return null
}

/**
 * @param {RegExpMatchArray} m
 */
function firstQuoted(m) {
  return m[1] ?? m[2] ?? null
}

/**
 * @param {RegExpMatchArray} m
 */
function secondQuoted(m) {
  return m[3] ?? m[4] ?? null
}
