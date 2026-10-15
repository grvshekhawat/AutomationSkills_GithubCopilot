#!/usr/bin/env node
/**
 * Create or merge locator-only WebdriverIO TypeScript page objects from locators.json / trace.
 *
 * Usage:
 *   node merge-page-object.mjs \
 *     --locators .pom-discover/locators.json \
 *     --project-root . \
 *     [--page-object pageobjects/login.page.ts] \
 *     [--page-key login]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Handlebars from './lib/tiny-hbs.mjs'
import {
  mergeGettersIntoSource,
  renderPageObject,
  toPageClassName,
  parseGetters,
} from './lib/ts-getters.mjs'
import { loadConfig } from './lib/load-config.mjs'

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const out = {
    locators: null,
    projectRoot: process.cwd(),
    pageObject: null,
    pageKey: null,
    config: null,
    template: null,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--locators') out.locators = argv[++i]
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i])
    else if (a === '--page-object') out.pageObject = argv[++i]
    else if (a === '--page-key') out.pageKey = argv[++i]
    else if (a === '--config') out.config = argv[++i]
    else if (a === '--template') out.template = argv[++i]
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

/**
 * Deduplicate getters by name (last write wins within a page key).
 * @param {object[]} entries
 */
function uniqueGetters(entries) {
  const map = new Map()
  for (const e of entries) {
    if (!e.getterName || !e.selector) continue
    map.set(e.getterName, {
      name: e.getterName,
      selector: e.selector,
      fragileRelative: !!e.fragileRelative,
    })
  }
  return [...map.values()]
}

/**
 * @param {string} pageKey
 * @param {string} pageObjectsDir
 */
function defaultPageObjectPath(projectRoot, pageObjectsDir, pageKey) {
  const fileBase = String(pageKey)
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return path.join(projectRoot, pageObjectsDir, `${fileBase}.page.ts`)
}

/**
 * Render via Handlebars template if present.
 * @param {string} templateSource
 * @param {object} data
 */
function renderTemplate(templateSource, data) {
  const compiled = Handlebars.compile(templateSource)
  return compiled(data)
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.locators) {
    console.log(`Usage: node merge-page-object.mjs --locators <locators.json> [options]

Options:
  --project-root <dir>
  --page-object <file>   Update this file only (uses --page-key or first key)
  --page-key <name>      Which key from locators.json to merge
  --config <file>
  --template <file>      Optional Handlebars template (defaults to templates/page.ts.hbs)`)
    process.exit(args.help ? 0 : 1)
  }

  const projectRoot = args.projectRoot
  const config = loadConfig(projectRoot, args.config)
  const locatorsPath = path.isAbsolute(args.locators)
    ? args.locators
    : path.join(projectRoot, args.locators)

  if (!fs.existsSync(locatorsPath)) {
    throw new Error(`locators file not found: ${locatorsPath}`)
  }

  /** @type {Record<string, object[]>} */
  const byPage = JSON.parse(fs.readFileSync(locatorsPath, 'utf8'))
  const keys = args.pageKey
    ? [args.pageKey]
    : args.pageObject
      ? [args.pageKey || Object.keys(byPage)[0]].filter(Boolean)
      : Object.keys(byPage)

  if (keys.length === 0 || (keys.length === 1 && !keys[0])) {
    throw new Error('No page keys found in locators.json')
  }

  const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const templatePath =
    args.template ||
    path.join(skillDir, 'templates', 'page.ts.hbs')
  const templateSource = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, 'utf8')
    : null

  const summary = []

  for (const pageKey of keys) {
    if (!byPage[pageKey]) {
      console.warn(`Skipping unknown page key: ${pageKey}`)
      continue
    }

    const getters = uniqueGetters(byPage[pageKey])
    const className = toPageClassName(pageKey)
    const openPath =
      byPage[pageKey].find((e) => e.url)?.url?.replace(/^https?:\/\/[^/]+/, '') ||
      `/${pageKey}`

    let targetPath = args.pageObject
      ? path.isAbsolute(args.pageObject)
        ? args.pageObject
        : path.join(projectRoot, args.pageObject)
      : defaultPageObjectPath(projectRoot, config.pageObjectsDir, pageKey)

    // When multiple keys and --page-object set, only first key uses that path
    if (args.pageObject && keys.indexOf(pageKey) > 0) {
      targetPath = defaultPageObjectPath(
        projectRoot,
        config.pageObjectsDir,
        pageKey
      )
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true })

    let result
    if (fs.existsSync(targetPath) && config.onExistingPageObject === 'merge') {
      const existing = fs.readFileSync(targetPath, 'utf8')
      result = mergeGettersIntoSource(existing, getters)
      fs.writeFileSync(targetPath, result.source)
    } else {
      let source
      if (templateSource) {
        source = renderTemplate(templateSource, {
          className,
          baseClass: 'Page',
          openPath,
          getters: getters.map((g) => ({
            name: g.name,
            selector: g.selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
          })),
        })
      } else {
        source = renderPageObject(className, getters, { openPath })
      }
      fs.writeFileSync(targetPath, source)
      result = {
        added: getters.map((g) => g.name),
        updated: [],
        unchanged: [],
      }
    }

    const fragile = getters.filter((g) => g.fragileRelative).map((g) => g.name)

    summary.push({
      pageKey,
      path: targetPath,
      getters: parseGetters(fs.readFileSync(targetPath, 'utf8')).length,
      added: result.added,
      updated: result.updated,
      unchanged: result.unchanged,
      fragileRelative: fragile,
    })
  }

  console.log(JSON.stringify({ ok: true, pages: summary }, null, 2))
}

if (
  import.meta.url === pathToFileURL(process.argv[1]).href ||
  process.argv[1]?.endsWith('merge-page-object.mjs')
) {
  main().catch((err) => {
    console.error(err.stack || err.message || err)
    process.exit(1)
  })
}
