/**
 * Strict locator resolution: configurable attribute on node or nearest ancestor + relative child CSS.
 * Never emits #id, class-only, text, or free XPath roots.
 */

/**
 * @typedef {object} LocatorResult
 * @property {string} attrValue
 * @property {string|null} relativeCss
 * @property {boolean} fragileRelative
 * @property {string} selector
 * @property {string} getterName
 */

/**
 * @typedef {object} DomNodeInfo
 * @property {string} tagName
 * @property {Record<string, string>} attributes
 * @property {string} [text]
 * @property {string} [ariaLabel]
 * @property {string} [role]
 * @property {DomNodeInfo|null} [parent]
 * @property {DomNodeInfo[]} [children]
 * @property {number} [indexAmongType]
 */

/**
 * @param {string} value
 */
export function escapeAttrValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * @param {string} attr
 * @param {string} value
 */
export function attributeRootSelector(attr, value) {
  return `[${attr}="${escapeAttrValue(value)}"]`
}

/**
 * @param {string} value
 */
export function toCamelCase(value) {
  const parts = String(value)
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return 'element'
  return parts
    .map((p, i) => {
      const lower = p.toLowerCase()
      if (i === 0) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
}

/**
 * @param {string} tagName
 */
export function tagSuffix(tagName) {
  const t = String(tagName || 'element').toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * @param {DomNodeInfo} parent
 * @param {DomNodeInfo} node
 * @param {string} tag
 * @param {string|undefined} type
 * @param {string|undefined} name
 */
function matchingSiblings(parent, tag, type, name) {
  return (parent.children || []).filter((c) => {
    if ((c.tagName || '').toLowerCase() !== tag) return false
    if (type) return c.attributes?.type === type
    if (name) return c.attributes?.name === name
    return true
  })
}

/**
 * @param {DomNodeInfo} ancestor
 * @param {DomNodeInfo} target
 * @returns {{ relativeCss: string|null, fragileRelative: boolean } | null}
 */
export function buildRelativeCss(ancestor, target) {
  if (ancestor === target) {
    return { relativeCss: null, fragileRelative: false }
  }

  /** @type {DomNodeInfo[]} */
  const chain = []
  let cur = target
  let guard = 0
  while (cur && cur !== ancestor && guard < 64) {
    chain.unshift(cur)
    cur = cur.parent ?? null
    guard += 1
  }
  if (cur !== ancestor) return null

  /** @type {string[]} */
  const segments = []
  let fragileRelative = false
  let parentInChain = ancestor

  for (const node of chain) {
    const tag = (node.tagName || 'div').toLowerCase()
    const type = node.attributes?.type
    const name = node.attributes?.name
    let segment = tag

    if (type) {
      segment = `${tag}[type="${escapeAttrValue(type)}"]`
    } else if (name) {
      segment = `${tag}[name="${escapeAttrValue(name)}"]`
    }

    const matches = matchingSiblings(parentInChain, tag, type, name)
    if (matches.length !== 1) {
      const idx = node.indexAmongType || 1
      segment = `${tag}:nth-of-type(${idx})`
      fragileRelative = true
    } else if (
      !type &&
      !name &&
      (parentInChain.children || []).length === 1 &&
      parentInChain.children[0] === node
    ) {
      segment = `> ${tag}`
    }

    segments.push(segment)
    parentInChain = node
  }

  return { relativeCss: segments.join(' '), fragileRelative }
}

/**
 * @param {DomNodeInfo} node
 * @param {object} options
 * @param {string} options.locatorAttribute
 * @param {boolean} [options.allowAncestorAttribute=true]
 * @param {number} [options.maxAncestorDepth=8]
 * @returns {LocatorResult | { gap: true, reason: string }}
 */
export function resolveLocator(node, options) {
  const attr = options.locatorAttribute
  const allowAncestor = options.allowAncestorAttribute !== false
  const maxDepth = options.maxAncestorDepth ?? 8

  if (!attr) {
    return { gap: true, reason: 'locatorAttribute not configured' }
  }

  const selfValue = node.attributes?.[attr]
  if (selfValue != null && selfValue !== '') {
    const selector = attributeRootSelector(attr, selfValue)
    return {
      attrValue: selfValue,
      relativeCss: null,
      fragileRelative: false,
      selector,
      getterName: toCamelCase(selfValue),
    }
  }

  if (!allowAncestor) {
    return {
      gap: true,
      reason: `element lacks [${attr}] and ancestor attribute resolution is disabled`,
    }
  }

  let ancestor = node.parent ?? null
  let depth = 0
  while (ancestor && depth < maxDepth) {
    const value = ancestor.attributes?.[attr]
    if (value != null && value !== '') {
      const relative = buildRelativeCss(ancestor, node)
      if (!relative) {
        return {
          gap: true,
          reason: `found ancestor [${attr}="${value}"] but could not build relative path`,
        }
      }
      const root = attributeRootSelector(attr, value)
      const selector = relative.relativeCss
        ? `${root} ${relative.relativeCss}`
        : root
      const baseName = toCamelCase(value)
      const getterName = relative.relativeCss
        ? `${baseName}${tagSuffix(node.tagName)}`
        : baseName
      return {
        attrValue: value,
        relativeCss: relative.relativeCss,
        fragileRelative: relative.fragileRelative,
        selector,
        getterName,
      }
    }
    ancestor = ancestor.parent ?? null
    depth += 1
  }

  return {
    gap: true,
    reason: `no [${attr}] on element or ancestors within depth ${maxDepth}`,
  }
}

/**
 * Function body for browser.execute — resolves locator for a stamped element.
 * Returns LocatorResult or { gap: true, reason }.
 */
export function browserResolveFromStamp() {
  return function resolveFromStamp(
    stamp,
    locatorAttribute,
    allowAncestorAttribute,
    maxAncestorDepth
  ) {
    function escapeAttrValue(value) {
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    }
    function toCamelCase(value) {
      const parts = String(value)
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
      if (parts.length === 0) return 'element'
      return parts
        .map((p, i) => {
          const lower = p.toLowerCase()
          if (i === 0) return lower
          return lower.charAt(0).toUpperCase() + lower.slice(1)
        })
        .join('')
    }
    function tagSuffix(tagName) {
      const t = String(tagName || 'element').toLowerCase()
      return t.charAt(0).toUpperCase() + t.slice(1)
    }
    function indexAmongType(node) {
      if (!node.parentElement) return 1
      const tag = node.tagName
      let i = 0
      for (const child of Array.from(node.parentElement.children)) {
        if (child.tagName === tag) {
          i += 1
          if (child === node) return i
        }
      }
      return 1
    }
    function buildRelative(ancestor, target) {
      if (ancestor === target) {
        return { relativeCss: null, fragileRelative: false }
      }
      const chain = []
      let cur = target
      while (cur && cur !== ancestor) {
        chain.unshift(cur)
        cur = cur.parentElement
      }
      if (cur !== ancestor) return null
      const segments = []
      let fragileRelative = false
      let parent = ancestor
      for (const node of chain) {
        const tag = node.tagName.toLowerCase()
        const type = node.getAttribute('type')
        const name = node.getAttribute('name')
        let segment = tag
        if (type) segment = `${tag}[type="${escapeAttrValue(type)}"]`
        else if (name) segment = `${tag}[name="${escapeAttrValue(name)}"]`

        const siblings = Array.from(parent.children).filter((c) => {
          if (c.tagName.toLowerCase() !== tag) return false
          if (type) return c.getAttribute('type') === type
          if (name) return c.getAttribute('name') === name
          return true
        })
        if (siblings.length !== 1) {
          segment = `${tag}:nth-of-type(${indexAmongType(node)})`
          fragileRelative = true
        } else if (!type && !name && parent.children.length === 1) {
          segment = `> ${tag}`
        }
        segments.push(segment)
        parent = node
      }
      return { relativeCss: segments.join(' '), fragileRelative }
    }

    const el = document.querySelector(
      `[data-pom-discover-stamp="${stamp}"]`
    )
    if (!el) {
      return { gap: true, reason: `stamped element ${stamp} not found` }
    }

    const selfValue = el.getAttribute(locatorAttribute)
    if (selfValue) {
      const selector = `[${locatorAttribute}="${escapeAttrValue(selfValue)}"]`
      return {
        attrValue: selfValue,
        relativeCss: null,
        fragileRelative: false,
        selector,
        getterName: toCamelCase(selfValue),
      }
    }

    if (allowAncestorAttribute === false) {
      return {
        gap: true,
        reason: `element lacks [${locatorAttribute}] and ancestor resolution is disabled`,
      }
    }

    let ancestor = el.parentElement
    let depth = 0
    const maxDepth = maxAncestorDepth || 8
    while (ancestor && depth < maxDepth) {
      const value = ancestor.getAttribute(locatorAttribute)
      if (value) {
        const relative = buildRelative(ancestor, el)
        if (!relative) {
          return {
            gap: true,
            reason: `ancestor [${locatorAttribute}="${value}"] found but relative path failed`,
          }
        }
        const root = `[${locatorAttribute}="${escapeAttrValue(value)}"]`
        const selector = relative.relativeCss
          ? `${root} ${relative.relativeCss}`
          : root
        const baseName = toCamelCase(value)
        return {
          attrValue: value,
          relativeCss: relative.relativeCss,
          fragileRelative: relative.fragileRelative,
          selector,
          getterName: relative.relativeCss
            ? `${baseName}${tagSuffix(el.tagName)}`
            : baseName,
        }
      }
      ancestor = ancestor.parentElement
      depth += 1
    }

    return {
      gap: true,
      reason: `no [${locatorAttribute}] on element or ancestors within depth ${maxDepth}`,
    }
  }
}

/**
 * Collect interactive candidates under [locatorAttribute] anchors. Stamps each with data-pom-discover-stamp.
 */
export function browserCollectCandidates() {
  return function collectCandidates(locatorAttribute) {
    function attrs(node) {
      const out = {}
      if (!node || !node.attributes) return out
      for (const a of Array.from(node.attributes)) {
        out[a.name] = a.value
      }
      return out
    }

    document
      .querySelectorAll('[data-pom-discover-stamp]')
      .forEach((el) => el.removeAttribute('data-pom-discover-stamp'))

    const anchors = Array.from(
      document.querySelectorAll(`[${locatorAttribute}]`)
    )
    const seen = new Set()
    const results = []

    function isVisible(el) {
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      const rect = el.getBoundingClientRect()
      return !(rect.width === 0 && rect.height === 0)
    }

    function pushCandidate(el, anchorValue) {
      if (!el || seen.has(el) || !isVisible(el)) return
      seen.add(el)
      const stamp = String(results.length)
      el.setAttribute('data-pom-discover-stamp', stamp)
      results.push({
        stamp,
        tagName: el.tagName.toLowerCase(),
        attributes: attrs(el),
        text: (el.innerText || el.value || '').trim().slice(0, 120),
        ariaLabel: el.getAttribute('aria-label') || '',
        role: el.getAttribute('role') || '',
        anchorValue,
      })
    }

    for (const anchor of anchors) {
      const anchorValue = anchor.getAttribute(locatorAttribute)
      pushCandidate(anchor, anchorValue)
      const interactive = anchor.querySelectorAll(
        'a, button, input, select, textarea, [role="button"], [role="textbox"], [role="checkbox"], [role="radio"], [role="link"], [contenteditable="true"]'
      )
      for (const el of Array.from(interactive)) {
        pushCandidate(el, anchorValue)
      }
    }

    return results
  }
}
