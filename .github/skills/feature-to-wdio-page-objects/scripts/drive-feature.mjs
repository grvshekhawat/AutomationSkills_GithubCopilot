#!/usr/bin/env node
/**
 * Open Chrome (ChromeDriver via WebdriverIO), run each UI-language Cucumber
 * step, and record strict attribute locators.
 *
 * Usage (from a WDIO project root):
 *   node <skill>/scripts/drive-feature.mjs \
 *     --feature features/login.feature \
 *     --project-root . \
 *     --out .pom-discover \
 *     --base-url https://staging.example.com
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { parseGherkin, stepsForScenario } from './lib/parse-gherkin.mjs'
import { parseUiStep } from './lib/step-grammar.mjs'
import { pickBestCandidate } from './lib/score-candidates.mjs'
import {
  browserCollectCandidates,
  browserResolveFromStamp,
} from './lib/resolve-locator.mjs'
import { loadConfig } from './lib/load-config.mjs'
import { pageNameFromUrl } from './lib/ts-getters.mjs'

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const out = {
    feature: null,
    projectRoot: process.cwd(),
    outDir: '.pom-discover',
    config: null,
    locatorAttribute: null,
    wdioConfig: null,
    scenario: null,
    headless: null,
    baseUrl: null,
    startUrl: null,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--feature') out.feature = argv[++i]
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i])
    else if (a === '--out') out.outDir = argv[++i]
    else if (a === '--config') out.config = argv[++i]
    else if (a === '--locator-attribute' || a === '--attr')
      out.locatorAttribute = argv[++i]
    else if (a === '--wdio-config') out.wdioConfig = argv[++i]
    else if (a === '--scenario') out.scenario = argv[++i]
    else if (a === '--headed') out.headless = false
    else if (a === '--headless') out.headless = true
    else if (a === '--base-url') out.baseUrl = argv[++i]
    else if (a === '--start-url' || a === '--url') out.startUrl = argv[++i]
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

/**
 * @param {string} projectRoot
 * @param {string|null} explicit
 */
async function loadWdioConfig(projectRoot, explicit) {
  const candidates = explicit
    ? [path.resolve(projectRoot, explicit)]
    : [
        'wdio.conf.ts',
        'wdio.conf.js',
        'wdio.conf.mjs',
        'wdio.conf.cjs',
        'config/wdio.conf.ts',
        'config/wdio.conf.js',
      ].map((f) => path.join(projectRoot, f))

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    try {
      const mod = await import(pathToFileURL(file).href)
      const cfg = mod.config || mod.default?.config || mod.default
      if (cfg) return { file, config: cfg }
    } catch (err) {
      try {
        const require = createRequire(path.join(projectRoot, 'package.json'))
        const mod = require(file)
        const cfg = mod.config || mod.default?.config || mod.default
        if (cfg) return { file, config: cfg }
      } catch {
        console.warn(
          `Could not load ${file}: ${err.message}. Will start local Chrome instead.`
        )
      }
    }
  }
  return { file: null, config: {} }
}

/**
 * Start a real Chrome session. Do NOT default to localhost:4444 — that assumes
 * a Selenium server. WDIO `remote()` starts ChromeDriver when hostname/port
 * are omitted.
 *
 * @param {string} projectRoot
 * @param {object} wdioConfig
 * @param {boolean} headless
 * @param {string} baseUrl
 */
async function createBrowser(projectRoot, wdioConfig, headless, baseUrl) {
  let remote
  try {
    const require = createRequire(path.join(projectRoot, 'package.json'))
    const wdioPath = require.resolve('webdriverio')
    ;({ remote } = await import(pathToFileURL(wdioPath).href))
  } catch {
    try {
      ;({ remote } = await import('webdriverio'))
    } catch {
      throw new Error(
        'webdriverio is not installed. From your WDIO project run: npm i -D webdriverio. The driver starts local Chrome via ChromeDriver (do not point at localhost:4444 unless you already have a Selenium server).'
      )
    }
  }

  const rawCaps = Array.isArray(wdioConfig.capabilities)
    ? wdioConfig.capabilities[0]
    : wdioConfig.capabilities
  const capability = {
    browserName: 'chrome',
    ...(rawCaps && typeof rawCaps === 'object' ? rawCaps : {}),
  }
  if (!capability.browserName) capability.browserName = 'chrome'

  const chromeOpts = { ...(capability['goog:chromeOptions'] || {}) }
  const args = [...(chromeOpts.args || [])]
  if (headless) {
    for (const flag of ['--headless=new', '--disable-gpu', '--window-size=1920,1080']) {
      if (!args.includes(flag)) args.push(flag)
    }
  } else {
    if (!args.includes('--window-size=1920,1080')) args.push('--window-size=1920,1080')
  }
  capability['goog:chromeOptions'] = { ...chromeOpts, args }

  /** @type {Record<string, unknown>} */
  const opts = {
    logLevel: wdioConfig.logLevel || 'error',
    baseUrl: baseUrl || wdioConfig.baseUrl || '',
    capabilities: capability,
    waitforTimeout: wdioConfig.waitforTimeout || 10000,
    connectionRetryTimeout: wdioConfig.connectionRetryTimeout || 180000,
    connectionRetryCount: wdioConfig.connectionRetryCount ?? 3,
  }

  // Only attach a remote server if the project config explicitly has one.
  if (wdioConfig.hostname) opts.hostname = wdioConfig.hostname
  if (wdioConfig.port) opts.port = wdioConfig.port
  if (wdioConfig.path) opts.path = wdioConfig.path
  if (wdioConfig.protocol) opts.protocol = wdioConfig.protocol
  if (wdioConfig.user) opts.user = wdioConfig.user
  if (wdioConfig.key) opts.key = wdioConfig.key
  if (wdioConfig.automationProtocol) {
    opts.automationProtocol = wdioConfig.automationProtocol
  }

  console.error(
    headless
      ? 'Starting Chrome (headless) via WebdriverIO/ChromeDriver…'
      : 'Opening Chrome via WebdriverIO/ChromeDriver…'
  )

  const browser = await remote(opts)
  return { browser, baseUrl: String(opts.baseUrl || '') }
}

/**
 * @param {string} dest
 * @param {string} baseUrl
 */
function resolveUrl(dest, baseUrl) {
  const d = String(dest || '').trim()
  if (!d) return baseUrl || ''
  if (/^https?:\/\//i.test(d) || d.startsWith('file:')) return d
  if (d.startsWith('/')) {
    if (!baseUrl) return d
    return new URL(d, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href
  }
  if (!baseUrl) return d
  return new URL(d.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href
}

async function currentPage(browser) {
  const url = await browser.getUrl()
  return { url, pageKey: pageNameFromUrl(url) }
}

/**
 * @param {import('webdriverio').Browser} browser
 * @param {object} uiStep
 * @param {object} config
 * @param {string} locatorAttribute
 */
async function collectAndPick(browser, uiStep, config, locatorAttribute) {
  const collectFn = browserCollectCandidates()
  const candidates = await browser.execute(collectFn, locatorAttribute)
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      match: null,
      ambiguous: [],
      scores: [],
      gapReason: `no elements with [${locatorAttribute}] are visible on this page`,
    }
  }
  return pickBestCandidate(
    candidates,
    uiStep,
    locatorAttribute,
    config.minScore,
    config.ambiguityDelta
  )
}

/**
 * @param {import('webdriverio').Browser} browser
 * @param {object} match
 * @param {object} config
 */
async function resolveMatch(browser, match, config) {
  const resolveFn = browserResolveFromStamp()
  return browser.execute(
    resolveFn,
    match.stamp,
    config.locatorAttribute,
    config.allowAncestorAttribute,
    config.maxAncestorDepth
  )
}

/**
 * @param {import('webdriverio').Browser} browser
 * @param {object} locator
 * @param {object} uiStep
 * @param {object} config
 */
async function performAction(browser, locator, uiStep, config) {
  const el = await browser.$(locator.selector)
  await el.waitForExist({ timeout: config.waitforTimeout || 10000 })
  switch (uiStep.action) {
    case 'click':
      await el.waitForClickable({ timeout: config.waitforTimeout || 10000 })
      await el.click()
      break
    case 'setValue':
    case 'login-setValue':
      await el.waitForDisplayed({ timeout: config.waitforTimeout || 10000 })
      await el.clearValue()
      await el.setValue(uiStep.value ?? '')
      break
    case 'clear':
      await el.clearValue()
      break
    case 'select':
      await el.selectByVisibleText(uiStep.value ?? '')
      break
    case 'check': {
      const selected = await el.isSelected()
      if (uiStep.value === 'check' && !selected) await el.click()
      if (uiStep.value === 'uncheck' && selected) await el.click()
      break
    }
    case 'assertVisible':
      await el.waitForDisplayed({ timeout: config.waitforTimeout || 10000 })
      break
    default:
      break
  }
}

/**
 * Login is a composite: open app (if needed) → username → password → submit.
 * Each successful control is recorded as a locator.
 *
 * @param {import('webdriverio').Browser} browser
 * @param {object} uiStep
 * @param {object} config
 * @param {string} baseUrl
 */
async function executeLogin(browser, uiStep, config, baseUrl) {
  const locators = []
  const gaps = []
  const attr = config.locatorAttribute

  const dest = uiStep.url || (baseUrl ? '/' : '')
  if (dest || baseUrl) {
    const current = await browser.getUrl().catch(() => '')
    const blank =
      !current ||
      current === 'data:,' ||
      current === 'about:blank' ||
      current.startsWith('data:')
    if (blank || uiStep.url) {
      await browser.url(resolveUrl(dest || '/', baseUrl))
    }
  }

  const fields = [
    {
      role: 'username',
      action: 'setValue',
      target: 'username',
      value: uiStep.username ?? '',
      required: true,
    },
    {
      role: 'password',
      action: 'setValue',
      target: 'password',
      value: uiStep.password ?? '',
      required: true,
    },
    {
      role: 'submit',
      action: 'click',
      target: 'login',
      value: null,
      required: true,
    },
  ]

  for (const field of fields) {
    const picked = await collectAndPick(
      browser,
      { action: field.action, target: field.target },
      config,
      attr
    )
    if (picked.ambiguous.length > 0) {
      gaps.push({
        reason: picked.gapReason,
        role: field.role,
        candidates: picked.ambiguous.map((c) => ({
          stamp: c.stamp,
          tagName: c.tagName,
          text: c.text,
          attr: c.attributes?.[attr],
          anchorValue: c.anchorValue,
        })),
      })
      if (config.onAmbiguousMatch === 'stop-scenario') {
        return { locators, gaps, stopScenario: true }
      }
      continue
    }
    if (!picked.match) {
      gaps.push({
        reason: picked.gapReason || `no ${field.role} field found`,
        role: field.role,
      })
      continue
    }
    const locator = await resolveMatch(browser, picked.match, config)
    if (locator.gap) {
      gaps.push({ reason: locator.reason, role: field.role })
      continue
    }
    locators.push({ ...locator, role: field.role })
    try {
      await performAction(
        browser,
        locator,
        { action: field.action, value: field.value },
        config
      )
    } catch (err) {
      gaps.push({
        reason: `action error on ${field.role}: ${err.message}`,
        role: field.role,
        locator,
      })
      if (config.onActionError === 'stop-scenario') {
        return { locators, gaps, stopScenario: true }
      }
    }
  }

  return { locators, gaps, stopScenario: false }
}

/**
 * @param {import('webdriverio').Browser} browser
 * @param {object} uiStep
 * @param {object} config
 * @param {string} baseUrl
 */
async function executeStep(browser, uiStep, config, baseUrl) {
  const attr = config.locatorAttribute
  const record = {
    action: uiStep.action,
    originalText: uiStep.originalText,
    target: uiStep.target,
    value: uiStep.value,
    url: null,
    locator: null,
    locators: [],
    gap: null,
    pageKey: null,
  }

  if (uiStep.action === 'observe') {
    Object.assign(record, await currentPage(browser))
    return { ok: true, record, stopScenario: false }
  }

  if (uiStep.action === 'navigate') {
    await browser.url(resolveUrl(uiStep.url || uiStep.target, baseUrl))
    Object.assign(record, await currentPage(browser))
    return { ok: true, record, stopScenario: false }
  }

  if (uiStep.action === 'login') {
    const result = await executeLogin(browser, uiStep, config, baseUrl)
    Object.assign(record, await currentPage(browser))
    record.locators = result.locators
    record.locator = result.locators[0] || null
    if (result.gaps.length) {
      record.gap = {
        reason: result.gaps.map((g) => g.reason).join('; '),
        details: result.gaps,
      }
    }
    return {
      ok: result.gaps.length === 0,
      record,
      stopScenario: result.stopScenario,
    }
  }

  if (uiStep.action === 'unknown' || !uiStep.supported) {
    record.gap = {
      reason: `unsupported UI step grammar: "${uiStep.originalText}"`,
    }
    return { ok: false, record, stopScenario: false }
  }

  const picked = await collectAndPick(browser, uiStep, config, attr)

  if (picked.ambiguous.length > 0) {
    record.gap = {
      reason: picked.gapReason,
      candidates: picked.ambiguous.map((c) => ({
        stamp: c.stamp,
        tagName: c.tagName,
        text: c.text,
        attr: c.attributes?.[attr],
        anchorValue: c.anchorValue,
      })),
    }
    return {
      ok: false,
      record,
      stopScenario: config.onAmbiguousMatch === 'stop-scenario',
    }
  }

  if (!picked.match) {
    record.gap = { reason: picked.gapReason || 'no match' }
    return {
      ok: false,
      record,
      stopScenario: config.onMissingAttribute === 'stop-scenario',
    }
  }

  const locator = await resolveMatch(browser, picked.match, config)
  if (locator.gap) {
    record.gap = {
      reason: locator.reason,
      candidate: {
        stamp: picked.match.stamp,
        tagName: picked.match.tagName,
        text: picked.match.text,
      },
    }
    return {
      ok: false,
      record,
      stopScenario: config.onMissingAttribute === 'stop-scenario',
    }
  }

  record.locator = locator
  record.locators = [locator]
  Object.assign(record, await currentPage(browser))

  try {
    await performAction(browser, locator, uiStep, config)
  } catch (err) {
    record.gap = { reason: `action error: ${err.message}`, locator }
    return {
      ok: false,
      record,
      stopScenario: config.onActionError === 'stop-scenario',
    }
  }

  Object.assign(record, await currentPage(browser))
  return { ok: true, record, stopScenario: false }
}

function flattenLocators(trace) {
  /** @type {Record<string, object[]>} */
  const byPage = {}
  for (const sc of trace.scenarios) {
    for (const st of sc.steps) {
      const items = [
        ...(st.locators || []),
        ...(st.locator && !(st.locators || []).length ? [st.locator] : []),
      ]
      for (const loc of items) {
        if (!loc || !loc.selector) continue
        const key = st.pageKey || 'page'
        if (!byPage[key]) byPage[key] = []
        byPage[key].push({
          getterName: loc.getterName,
          selector: loc.selector,
          attrValue: loc.attrValue,
          relativeCss: loc.relativeCss,
          fragileRelative: loc.fragileRelative,
          url: st.url,
          action: st.action,
          role: loc.role,
          stepText: st.text,
        })
      }
    }
  }
  return byPage
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.feature) {
    console.log(`Usage: node drive-feature.mjs --feature <path> [options]

Opens Chrome via WebdriverIO/ChromeDriver and performs each UI step.

Options:
  --project-root <dir>     WDIO project root (default: cwd)
  --out <dir>              Output directory for trace/gaps (default: .pom-discover)
  --config <file>          pom-discover config JSON
  --locator-attribute <a>  Override locator attribute
  --wdio-config <file>     Path to wdio.conf.*
  --base-url <url>         App base URL (overrides wdio.conf baseUrl)
  --start-url <url>        Open this URL before the first step
  --scenario <name>        Run only this scenario
  --headed                 Visible Chrome (default)
  --headless               Run Chrome headless`)
    process.exit(args.help ? 0 : 1)
  }

  const projectRoot = args.projectRoot
  const featurePath = path.isAbsolute(args.feature)
    ? args.feature
    : path.join(projectRoot, args.feature)

  if (!fs.existsSync(featurePath)) {
    throw new Error(`Feature file not found: ${featurePath}`)
  }

  const config = loadConfig(projectRoot, args.config)
  if (args.locatorAttribute) config.locatorAttribute = args.locatorAttribute
  const headless =
    args.headless != null ? args.headless : config.headless === true

  const feature = parseGherkin(fs.readFileSync(featurePath, 'utf8'), featurePath)
  const scenarios = args.scenario
    ? feature.scenarios.filter((s) => s.name === args.scenario)
    : feature.scenarios

  if (scenarios.length === 0) {
    throw new Error('No scenarios to run')
  }

  const { config: wdioConfig, file: wdioFile } = await loadWdioConfig(
    projectRoot,
    args.wdioConfig
  )
  if (wdioFile) console.error(`Using WDIO config: ${wdioFile}`)
  else console.error('No wdio.conf found; starting local Chrome via WebdriverIO.')

  const baseUrl = args.baseUrl || wdioConfig.baseUrl || ''
  const outDir = path.isAbsolute(args.outDir)
    ? args.outDir
    : path.join(projectRoot, args.outDir)
  fs.mkdirSync(outDir, { recursive: true })

  const { browser } = await createBrowser(
    projectRoot,
    wdioConfig,
    headless,
    baseUrl
  )

  const trace = {
    featurePath,
    featureName: feature.name,
    locatorAttribute: config.locatorAttribute,
    generatedAt: new Date().toISOString(),
    scenarios: [],
  }
  /** @type {object[]} */
  const gaps = []

  try {
    if (args.startUrl || baseUrl) {
      await browser.url(resolveUrl(args.startUrl || '/', baseUrl))
    }

    for (const scenario of scenarios) {
      const scenarioTrace = {
        name: scenario.name,
        line: scenario.line,
        steps: [],
        stopped: false,
        stopReason: null,
      }

      const steps = stepsForScenario(feature, scenario)
      for (const step of steps) {
        console.error(`→ ${step.keyword} ${step.text}`)
        const uiStep = parseUiStep(step.text, step.tableMap || {})
        const result = await executeStep(browser, uiStep, config, baseUrl)
        scenarioTrace.steps.push({
          keyword: step.keyword,
          text: step.text,
          line: step.line,
          tableMap: step.tableMap || {},
          ...result.record,
        })

        if (result.record.gap) {
          gaps.push({
            scenario: scenario.name,
            step: step.text,
            line: step.line,
            ...result.record.gap,
          })
        }

        if (result.stopScenario) {
          scenarioTrace.stopped = true
          scenarioTrace.stopReason =
            result.record.gap?.reason || 'stopped by policy'
          break
        }
      }

      trace.scenarios.push(scenarioTrace)
    }
  } finally {
    await browser.deleteSession().catch(() => {})
  }

  const tracePath = path.join(outDir, 'trace.json')
  const gapsPath = path.join(outDir, 'gaps.json')
  const locatorsPath = path.join(outDir, 'locators.json')
  const byPage = flattenLocators(trace)
  fs.writeFileSync(tracePath, JSON.stringify(trace, null, 2))
  fs.writeFileSync(gapsPath, JSON.stringify(gaps, null, 2))
  fs.writeFileSync(locatorsPath, JSON.stringify(byPage, null, 2))

  console.log(
    JSON.stringify(
      {
        ok: true,
        trace: tracePath,
        gaps: gapsPath,
        locators: locatorsPath,
        gapCount: gaps.length,
        pageKeys: Object.keys(byPage),
      },
      null,
      2
    )
  )
}

if (
  import.meta.url === pathToFileURL(process.argv[1]).href ||
  process.argv[1]?.endsWith('drive-feature.mjs')
) {
  main().catch((err) => {
    console.error(err.stack || err.message || err)
    process.exit(1)
  })
}
