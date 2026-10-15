/**
 * Map UI-language Cucumber step text → structured actions.
 */

/**
 * @typedef {'click'|'setValue'|'select'|'clear'|'check'|'navigate'|'assertVisible'|'unknown'} StepAction
 */

/**
 * @typedef {object} ParsedUiStep
 * @property {StepAction} action
 * @property {string|null} target - UI target phrase (label / name)
 * @property {string|null} value - typed/selected value when applicable
 * @property {string|null} url - for navigate
 * @property {string} originalText
 * @property {boolean} supported
 */

const QUOTED = `"([^"]*)"|'([^']*)'`

/**
 * @param {string} text - step text without Given/When/Then
 * @returns {ParsedUiStep}
 */
export function parseUiStep(text) {
  const originalText = text.trim()
  const t = originalText

  /** @type {ParsedUiStep} */
  const base = {
    action: 'unknown',
    target: null,
    value: null,
    url: null,
    originalText,
    supported: false,
  }

  // Navigate
  let m =
    t.match(
      new RegExp(
        `^I\\s+(?:open|go\\s+to|navigate\\s+to)\\s+(?:the\\s+page\\s+)?(?:${QUOTED}|(\\S+))\\s*$`,
        'i'
      )
    ) ||
    t.match(
      new RegExp(`^I\\s+am\\s+on\\s+(?:the\\s+page\\s+)?(?:${QUOTED}|(\\S+))\\s*$`, 'i')
    )
  if (m) {
    return {
      ...base,
      action: 'navigate',
      url: pick(m) || m[m.length - 1],
      supported: true,
    }
  }

  // Click
  m = t.match(
    new RegExp(
      `^I\\s+click\\s+(?:on\\s+)?(?:the\\s+)?(?:${QUOTED})(?:\\s+(?:button|link|checkbox|radio|element))?\\s*$`,
      'i'
    )
  )
  if (m) {
    return { ...base, action: 'click', target: pick(m), supported: true }
  }

  // Enter / type / fill
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
      target: secondQuoted(m),
      supported: true,
    }
  }

  // Alternate: I enter "x" into the Email field (field word after)
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
      target: (m[3] || m[2] || '').trim(),
      supported: true,
    }
  }

  // Select
  m = t.match(
    new RegExp(
      `^I\\s+select\\s+(?:${QUOTED})\\s+from\\s+(?:the\\s+)?(?:${QUOTED})(?:\\s+dropdown|\\s+select)?\\s*$`,
      'i'
    )
  )
  if (m) {
    return {
      ...base,
      action: 'select',
      value: firstQuoted(m),
      target: secondQuoted(m),
      supported: true,
    }
  }

  // Clear
  m = t.match(
    new RegExp(
      `^I\\s+clear\\s+(?:the\\s+)?(?:${QUOTED})(?:\\s+field)?\\s*$`,
      'i'
    )
  )
  if (m) {
    return { ...base, action: 'clear', target: pick(m), supported: true }
  }

  // Check / uncheck
  m = t.match(
    new RegExp(
      `^I\\s+(check|uncheck)\\s+(?:the\\s+)?(?:${QUOTED})(?:\\s+checkbox)?\\s*$`,
      'i'
    )
  )
  if (m) {
    return {
      ...base,
      action: 'check',
      target: pick(m),
      value: m[1].toLowerCase() === 'check' ? 'check' : 'uncheck',
      supported: true,
    }
  }

  // Assert visible
  m =
    t.match(
      new RegExp(
        `^I\\s+should\\s+see\\s+(?:the\\s+)?(?:${QUOTED})(?:\\s+(?:message|label|text|element|button|link))?\\s*$`,
        'i'
      )
    ) ||
    t.match(
      new RegExp(
        `^(?:the\\s+)?(?:${QUOTED})\\s+should\\s+be\\s+visible\\s*$`,
        'i'
      )
    )
  if (m) {
    return {
      ...base,
      action: 'assertVisible',
      target: pick(m),
      supported: true,
    }
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
 * First quoted capture in match (groups alternate " and ').
 * @param {RegExpMatchArray} m
 */
function firstQuoted(m) {
  return m[1] ?? m[2] ?? null
}

/**
 * Second quoted pair.
 * @param {RegExpMatchArray} m
 */
function secondQuoted(m) {
  return m[3] ?? m[4] ?? null
}
