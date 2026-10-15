/**
 * Score DOM candidates against a UI step target phrase.
 * Only candidates already limited to attributed subtrees should be passed in.
 */

/**
 * @typedef {object} Candidate
 * @property {string} stamp
 * @property {string} tagName
 * @property {Record<string, string>} attributes
 * @property {string} text
 * @property {string} ariaLabel
 * @property {string} role
 * @property {string} [anchorValue]
 */

/**
 * @typedef {object} ScoreResult
 * @property {Candidate} candidate
 * @property {number} score
 * @property {string[]} reasons
 */

/**
 * @param {string} a
 * @param {string} b
 */
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * @param {string} hay
 * @param {string} needle
 */
function includesScore(hay, needle) {
  const h = norm(hay)
  const n = norm(needle)
  if (!n || !h) return 0
  if (h === n) return 100
  if (h.includes(n) || n.includes(h)) return 70
  const hParts = new Set(h.split(/\s+/))
  const nParts = n.split(/\s+/).filter(Boolean)
  const overlap = nParts.filter((p) => hParts.has(p)).length
  if (overlap === 0) return 0
  return Math.round((overlap / nParts.length) * 50)
}

/**
 * Preferred tags/roles per action.
 * @param {string} action
 * @param {Candidate} c
 */
function actionFit(action, c) {
  const tag = c.tagName
  const role = (c.role || '').toLowerCase()
  const type = (c.attributes?.type || '').toLowerCase()

  switch (action) {
    case 'setValue':
    case 'clear':
      if (tag === 'input' && !['button', 'submit', 'checkbox', 'radio'].includes(type))
        return 25
      if (tag === 'textarea') return 25
      if (role === 'textbox') return 20
      return 0
    case 'select':
      if (tag === 'select') return 25
      if (role === 'listbox' || role === 'combobox') return 20
      return 0
    case 'check':
      if (type === 'checkbox' || type === 'radio') return 25
      if (role === 'checkbox' || role === 'radio') return 20
      return 0
    case 'click':
      if (['button', 'a'].includes(tag)) return 20
      if (type === 'submit' || type === 'button') return 20
      if (['button', 'link'].includes(role)) return 15
      return 5
    case 'assertVisible':
      return 10
    default:
      return 0
  }
}

/**
 * @param {Candidate} c
 * @param {string} target
 * @param {string} action
 * @param {string} locatorAttribute
 * @returns {ScoreResult}
 */
export function scoreCandidate(c, target, action, locatorAttribute) {
  const reasons = []
  let score = 0
  const attrVal = c.attributes?.[locatorAttribute] || c.anchorValue || ''

  const parts = [
    ['attribute', attrVal],
    ['ariaLabel', c.ariaLabel],
    ['text', c.text],
    ['name', c.attributes?.name || ''],
    ['placeholder', c.attributes?.placeholder || ''],
    ['title', c.attributes?.title || ''],
  ]

  for (const [label, value] of parts) {
    const s = includesScore(value, target)
    if (s > 0) {
      score += s
      reasons.push(`${label}:${s}`)
    }
  }

  const fit = actionFit(action, c)
  if (fit) {
    score += fit
    reasons.push(`actionFit:${fit}`)
  }

  return { candidate: c, score, reasons }
}

/**
 * @param {Candidate[]} candidates
 * @param {object} step
 * @param {string} step.target
 * @param {string} step.action
 * @param {string} locatorAttribute
 * @param {number} [minScore=40]
 * @param {number} [ambiguityDelta=10]
 * @returns {{ match: Candidate|null, ambiguous: Candidate[], scores: ScoreResult[], gapReason?: string }}
 */
export function pickBestCandidate(
  candidates,
  step,
  locatorAttribute,
  minScore = 40,
  ambiguityDelta = 10
) {
  const target = step.target || ''
  if (!target) {
    return {
      match: null,
      ambiguous: [],
      scores: [],
      gapReason: 'step has no target phrase',
    }
  }

  const scores = candidates
    .map((c) => scoreCandidate(c, target, step.action, locatorAttribute))
    .sort((a, b) => b.score - a.score)

  if (scores.length === 0 || scores[0].score < minScore) {
    return {
      match: null,
      ambiguous: [],
      scores,
      gapReason: `no candidate scored >= ${minScore} for target "${target}"`,
    }
  }

  const top = scores[0]
  const close = scores.filter(
    (s) => s.score >= top.score - ambiguityDelta && s.candidate !== top.candidate
  )

  // Ambiguous if another distinct element is within delta
  const ambiguousPeers = close.filter(
    (s) => s.candidate.stamp !== top.candidate.stamp
  )
  if (ambiguousPeers.length > 0 && ambiguousPeers[0].score === top.score) {
    return {
      match: null,
      ambiguous: [top.candidate, ...ambiguousPeers.map((s) => s.candidate)],
      scores,
      gapReason: `ambiguous match for target "${target}"`,
    }
  }

  return { match: top.candidate, ambiguous: [], scores }
}
