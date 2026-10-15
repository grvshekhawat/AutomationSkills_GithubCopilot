#!/usr/bin/env node
/**
 * Drive a WebdriverIO browser through UI-language Cucumber steps and record
 * strict attribute locators to trace.json (+ gaps.json).
 *
 * Usage (from a WDIO project root):
 *   node <skill>/scripts/drive-feature.mjs \
 *     --feature features/login.feature \
 *     --project-root . \
 *     --out .pom-discover
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
    headless: true,
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
      // TS configs may fail without a loader — try require for CJS
      try {
        const require = createRequire(path.join(projectRoot, 'package.json'))
        const mod = require(file)
        const cfg = mod.config || mod.default?.config || mod.default
        if (cfg) return { file, config: cfg }
      } catch {
        console.warn(
          `Could not load ${file}: ${err.message}. Continuing with defaults.`
        )
      }
    }
  }
  return { file: null, config: {} }
}

/**
 * @param {string} projectRoot
 */
async function createBrowser(projectRoot, wdioConfigFile, wdioConfig, headless) {
  let remote
  try {
    const require = createRequire(path.join(projectRoot, 'package.json'))
    // Resolve webdriverio from the consumer project
    const wdioPath = require.resolve('webdriverio')
    ;({ remote } = await import(pathToFileURL(wdioPath).href))
  } catch {
    try {
      ;({ remote } = await import('webdriverio'))
    } catch {
      throw new Error(
        'webdriverio is not installed. Run this script from a WDIO project (npm i webdriverio) or install webdriverio as a dependency.'
      )
    }
  }

  const caps = {
    ...(wdioConfig.capabilities?.[0] ||
      wdioConfig.capabilities ||
      {
        browserName: 'chrome',
      }),
  }

  // Normalize single capability object
  const capability = Array.isArray(wdioConfig.capabilities)
    ? { ...wdioConfig.capabilities[0] }
    : { ...caps }

  if (headless) {
    const browserName = (capability.browserName || 'chrome').toLowerCase()
    if (browserName.includes('chrome') || browserName.includes('chromium')) {
      capability['goog:chromeOptions'] = {
        ...(capability['goog:chromeOptions'] || {}),
        args: [
          ...new Set([
            ...((capability['goog:chromeOptions'] || {}).args || []),
            '--headless',
            '--disable-gpu',
            '--window-size=1920,1080',
          ]),
        ],
      }
    } else if (browserName.includes('firefox')) {
      capability['moz:firefoxOptions'] = {
        ...(capability['moz:firefoxOptions'] || {}),
        args: [
          ...new Set([
            ...((capability['moz:firefoxOptions'] || {}).args || []),
            '-headless',
          ]),
        ],
      }
    }
  }

  const browser = await remote({
    protocol: wdioConfig.protocol,
    hostname: wdioConfig.hostname || 'localhost',
    port: wdioConfig.port || 4444,
    path: wdioConfig.path,
    user: wdioConfig.user,
    key: wdioConfig.key,
    logLevel: wdioConfig.logLevel || 'error',
    baseUrl: wdioConfig.baseUrl,
    capabilities: capability,
    waitforTimeout: wdioConfig.waitforTimeout || 10000,
    connectionRetryTimeout: wdioConfig.connectionRetryTimeout || 120000,
    connectionRetryCount: wdioConfig.connectionRetryCount ?? 2,
  })

  return { browser, baseUrl: wdioConfig.baseUrl || '' }
}

/**
 * @param {import('webdriverio').Browser} browser
 * @param {object} uiStep
 * @param {object} config
 * @param {string} baseUrl
 */
async function executeStep(browser, uiStep, config, baseUrl) {
  const attr = config.locatorAttribute
  /** @type {object} */
  const record = {
    action: uiStep.action,
    originalText: uiStep.originalText,
    target: uiStep.target,
    value: uiStep.value,
    url: null,
    locator: null,
    gap: null,
    pageKey: null,
  }

  if (uiStep.action === 'navigate') {
    const dest = uiStep.url || ''
    const absolute =
      /^https?:\/\//i.test(dest) || dest.startsWith('file:')
        ? dest
        : new URL(dest.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href
    await browser.url(absolute)
    record.url = await browser.getUrl()
    record.pageKey = pageNameFromUrl(record.url)
    return { ok: true, record, stopScenario: false }
  }

  if (uiStep.action === 'unknown' || !uiStep.supported) {
    record.gap = {
      reason: `unsupported UI step grammar: "${uiStep.originalText}"`,
    }
    return {
      ok: false,
      record,
      stopScenario: false,
    }
  }

  const collectFn = browserCollectCandidates()
  const candidates = await browser.execute(collectFn, attr)

  const picked = pickBestCandidate(
    candidates,
    uiStep,
    attr,
    config.minScore,
    config.ambiguityDelta
  )

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

  const resolveFn = browserResolveFromStamp()
  const locator = await browser.execute(
    resolveFn,
    picked.match.stamp,
    attr,
    config.allowAncestorAttribute,
    config.maxAncestorDepth
  )

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
  record.url = await browser.getUrl()
  record.pageKey = pageNameFromUrl(record.url)

  const el = await browser.$(locator.selector)
  await el.waitForExist({ timeout: config.waitforTimeout || 10000 })

  try {
    switch (uiStep.action) {
      case 'click':
        await el.click()
        break
      case 'setValue':
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
  } catch (err) {
    record.gap = {
      reason: `action error: ${err.message}`,
      locator,
    }
    return {
      ok: false,
      record,
      stopScenario: config.onActionError === 'stop-scenario',
    }
  }

  return { ok: true, record, stopScenario: false }
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.feature) {
    console.log(`Usage: node drive-feature.mjs --feature <path> [options]

Options:
  --project-root <dir>     WDIO project root (default: cwd)
  --out <dir>              Output directory for trace/gaps (default: .pom-discover)
  --config <file>          pom-discover config JSON
  --locator-attribute <a>  Override locator attribute
  --wdio-config <file>     Path to wdio.conf.*
  --scenario <name>        Run only this scenario
  --headed                 Run browser headed (default headless)`)
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

  const feature = parseGherkin(
    fs.readFileSync(featurePath, 'utf8'),
    featurePath
  )

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
  if (wdioFile) {
    console.error(`Using WDIO config: ${wdioFile}`)
  } else {
    console.error(
      'No wdio.conf found; using defaults (chrome on localhost:4444). Prefer providing --wdio-config or a local Selenium/ChromeDriver endpoint.'
    )
  }

  const outDir = path.isAbsolute(args.outDir)
    ? args.outDir
    : path.join(projectRoot, args.outDir)
  fs.mkdirSync(outDir, { recursive: true })

  const { browser, baseUrl } = await createBrowser(
    projectRoot,
    wdioFile,
    wdioConfig,
    args.headless
  )

  /** @type {object} */
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
        const uiStep = parseUiStep(step.text)
        const result = await executeStep(browser, uiStep, config, baseUrl)
        scenarioTrace.steps.push({
          keyword: step.keyword,
          text: step.text,
          line: step.line,
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
  fs.writeFileSync(tracePath, JSON.stringify(trace, null, 2))
  fs.writeFileSync(gapsPath, JSON.stringify(gaps, null, 2))

  // Flatten locators for merge script
  /** @type {Record<string, object[]>} */
  const byPage = {}
  for (const sc of trace.scenarios) {
    for (const st of sc.steps) {
      if (!st.locator) continue
      const key = st.pageKey || 'page'
      if (!byPage[key]) byPage[key] = []
      byPage[key].push({
        getterName: st.locator.getterName,
        selector: st.locator.selector,
        attrValue: st.locator.attrValue,
        relativeCss: st.locator.relativeCss,
        fragileRelative: st.locator.fragileRelative,
        url: st.url,
        action: st.action,
        stepText: st.text,
      })
    }
  }
  const locatorsPath = path.join(outDir, 'locators.json')
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
