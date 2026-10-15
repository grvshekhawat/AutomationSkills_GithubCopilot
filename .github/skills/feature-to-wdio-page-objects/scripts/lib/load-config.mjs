import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_CONFIG = {
  locatorAttribute: 'test-automation-id',
  strict: true,
  allowAncestorAttribute: true,
  maxAncestorDepth: 8,
  featuresGlob: 'features/**/*.feature',
  stepDefinitionsGlob: 'step_definition/**/*.ts',
  pageObjectsDir: 'pageobjects',
  pageObjectsGlob: 'pageobjects/**/*.ts',
  generate: 'locators-only',
  onExistingPageObject: 'merge',
  preserveUnusedGetters: true,
  onMissingAttribute: 'record-gap-and-continue',
  onAmbiguousMatch: 'stop-scenario',
  onActionError: 'stop-scenario',
  minScore: 25,
  ambiguityDelta: 10,
  headless: false,
}

/**
 * @param {string} projectRoot
 * @param {string} [configPath]
 */
export function loadConfig(projectRoot, configPath) {
  const candidates = [
    configPath,
    path.join(projectRoot, 'pom-discover.config.json'),
    path.join(
      projectRoot,
      '.github/skills/feature-to-wdio-page-objects/config.json'
    ),
  ].filter(Boolean)

  let fileConfig = {}
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      fileConfig = JSON.parse(fs.readFileSync(p, 'utf8'))
      break
    }
  }

  return { ...DEFAULT_CONFIG, ...fileConfig }
}
