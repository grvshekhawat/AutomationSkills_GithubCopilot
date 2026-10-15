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
  Requires Node.js, a WebdriverIO project with wdio.conf.* and a running
  browser driver endpoint (or local Chrome via WDIO config), and network access
  to the application under test.
---

# Feature-to-WDIO Page Objects

## When to use

The user provides a **local path** to a `.feature` file (do **not** ask them to paste feature contents). Drive the browser yourself via the skill scripts, then create or merge locator-only page objects.

## Inputs to collect

1. Feature path (e.g. `features/login.feature`) — required
2. WDIO project root (default: workspace root) — must contain or resolve `wdio.conf.*`
3. `locatorAttribute` (default from config / `test-automation-id`)
4. Optional existing page object path to update (e.g. `pageobjects/login.page.ts`)
5. Optional `--scenario` name to run a single scenario

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

```bash
node .github/skills/feature-to-wdio-page-objects/scripts/drive-feature.mjs \
  --feature <path-to.feature> \
  --project-root . \
  --out .pom-discover \
  --locator-attribute <attr>
```

Optional: `--page-object` is applied in the merge step, not the driver. Use `--scenario "Name"`, `--headed`, `--wdio-config path`, `--config pom-discover.config.json` as needed.

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

## UI step grammar supported by the driver

- Navigate: `I open "/path"`, `I go to "…"`, `I am on "…"`
- Click: `I click "Save"`, `I click the "Save" button`
- Type: `I enter "x" into "Email"`, `I type "x" in "Email"`
- Select: `I select "CA" from "State"`
- Clear: `I clear "Search"`
- Check: `I check "Agree"` / `I uncheck "Agree"`
- Assert: `I should see "Welcome"`

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
