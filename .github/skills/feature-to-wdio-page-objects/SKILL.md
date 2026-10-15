---
name: feature-to-wdio-page-objects
description: >
  Drive a WebdriverIO browser to execute UI-language Cucumber steps from a
  feature file, resolve elements only via a configurable test attribute (or
  ancestor attribute + child path), and create or update locator-only
  TypeScript page objects under pageobjects/. Use when asked for WDIO page
  objects, POM from feature, locators from Cucumber, feature-to-page-objects,
  test-automation-id locators, or merge page object getters from a feature path.
compatibility: >
  Requires Node.js, webdriverio in the consumer project (starts local
  ChromeDriver automatically), and network access to the application under test.
  Do not assume a Selenium server on localhost:4444.
---

# Feature-to-WDIO Page Objects

## When to use

The user provides a **local path** to a `.feature` file (do **not** ask them to paste feature contents). Drive the browser yourself via the skill scripts, then create or merge locator-only page objects.

## Inputs to collect

1. Feature path (e.g. `features/login.feature`) — required
2. WDIO project root (default: workspace root) with `webdriverio` installed
3. App `--base-url` or `wdio.conf` `baseUrl` so Chrome can open the app
4. `locatorAttribute` (default from config / `test-automation-id`)
5. Optional existing page object path to update (e.g. `pageobjects/login.page.ts`)

Copy `config.example.json` to `pom-discover.config.json` in the project root if overrides are needed.

## Hard rules

1. **Never** invent locators. Only emit selectors produced by `drive-feature.mjs` / `locators.json`.
2. **Strict attribute policy:** every selector must be rooted at `[<locatorAttribute>="…"]`.
3. Ancestor + relative child CSS is allowed when the interacted node lacks the attribute but a near ancestor has it (e.g. `$('[test-automation-id="login-username-field"] input')`).
4. **Never** generate `#id`, class-only, link text, or free XPath root selectors.
5. **Locators only** in v1 — do not generate step definitions or action methods.
6. When updating an existing page object: **merge** getters; **do not delete** unused getters.
7. Do not paste feature file contents into the user-facing summary (privacy). Report counts, page keys, gaps, and file paths only.

## Workflow

1. Confirm Node + project root. Prefer the consumer project's `webdriverio` dependency.
2. Run the driver (from project root):

This **opens Chrome via ChromeDriver** (visible window by default), walks each step, finds attributed elements, and **performs** the action before recording the locator.

```bash
node .github/skills/feature-to-wdio-page-objects/scripts/drive-feature.mjs \
  --feature <path-to.feature> \
  --project-root . \
  --out .pom-discover \
  --locator-attribute <attr> \
  --base-url <app-url>
```

- Default is **headed Chrome**. Pass `--headless` only if the user asks.
- Do **not** start Selenium on port 4444. Omit hostname/port so WDIO starts ChromeDriver.
- `--page-object` is applied in the merge step. Optional: `--scenario "Name"`, `--start-url`, `--wdio-config`, `--config`.

3. Merge locators into page objects:

```bash
node .github/skills/feature-to-wdio-page-objects/scripts/merge-page-object.mjs \
  --locators .pom-discover/locators.json \
  --project-root . \
  --page-object pageobjects/login.page.ts
```

Omit `--page-object` to write one file per page key under `pageobjects/`.

4. Summarize for the user:
   - Pages created/updated and getter names added/updated
   - Gap count from `.pom-discover/gaps.json` (missing attribute / ambiguous / unsupported steps)
   - Any `fragileRelative` getters (nth-of-type) for manual review

5. Match style in `examples/login.page.ts` (TypeScript, `@wdio/globals`, getters returning `$()`).

## Locator resolution (must follow)

For the element chosen for a step:

1. If it has `locatorAttribute` → `$('[attr="value"]')`
2. Else nearest ancestor within `maxAncestorDepth` with that attribute → `$('[attr="value"] <relativeCss>')`
3. Else record a gap — do not substitute another strategy

## How each step is executed

For every step the driver:

1. Opens/uses the Chrome session (started at `baseUrl` / `--start-url`)
2. Collects only elements under `[locatorAttribute]`
3. Scores them against the step text (quoted or unquoted: `I click submit`)
4. Builds a strict locator and **performs** the action (`click`, `setValue`, …)
5. Appends that locator to the trace

**Login is composite.** `Given I login to <app>` plus a data table finds username, password, and submit — records all three locators and types/clicks them:

```
Given I login to Bla bla bla
  | User     | Password   |
  | UserName | Welcome123 |
When I click submit
Then I enter my name
```

## UI step grammar

- Login: `I login to …` / `I log in` + `|User|Password|` table
- Navigate: `I open "/path"`, `I go to "…"`
- Click: `I click submit`, `I click "Save"`, `I click the Save button`
- Type: `I enter my name` (value from table when present), `I enter "x" into "Email"`
- Select / clear / check as before
- Assert: `I should see "Welcome"`
- Outcome-only (`Then this happens`) is observed, not failed as unsupported

Unsupported steps are recorded as gaps and skipped (scenario continues unless policy says otherwise).

## Failure policies (config)

- `onMissingAttribute`: default `record-gap-and-continue`
- `onAmbiguousMatch`: default `stop-scenario`
- `onActionError`: default `stop-scenario`

## Out of scope

- Generating or updating `step_definition/**/*.ts`
- Deleting unused getters
- Non-attribute fallback locators
- Appium / mobile selector packs
