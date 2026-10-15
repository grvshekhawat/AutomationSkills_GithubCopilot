# Feature-to-WDIO Page Objects (GitHub Copilot Skill)

GitHub Copilot agent skill that **drives WebdriverIO** through UI-language Cucumber feature files, records **strict configurable-attribute locators** (with ancestor + child paths when needed), and **creates or merges locator-only** TypeScript page objects.

Feature file contents stay local — pass **paths** only.

## Install

### Option A — copy into a WDIO repo

Copy the skill folder into your automation repository:

```text
.github/skills/feature-to-wdio-page-objects/
```

### Option B — GitHub CLI skills (when publishing this repo)

```bash
gh skill install <owner>/<this-repo> feature-to-wdio-page-objects
```

Preview first:

```bash
gh skill preview <owner>/<this-repo> feature-to-wdio-page-objects
```

### Personal install

```text
~/.copilot/skills/feature-to-wdio-page-objects/
```

## Peer requirements (consumer WDIO project)

- Node.js 18+
- `webdriverio` installed in the project (it **starts ChromeDriver** and opens Chrome)
- Chrome installed locally
- App URL via `wdio.conf` `baseUrl` or `--base-url`
- UI elements tagged with your locator attribute (default `test-automation-id`), or a parent wrapper that has it

Do not require a Selenium server on `localhost:4444`. Pass `--headless` to hide the window; default is a visible Chrome session.

Optional project config (copy from the skill):

```bash
cp .github/skills/feature-to-wdio-page-objects/config.example.json pom-discover.config.json
```

Expected layout in the consumer project:

```text
features/**/*.feature
step_definition/**/*.ts   # optional; not generated in v1
pageobjects/**/*.ts       # created / merged
wdio.conf.*
```

## Quick start

From the **WDIO project root**:

```bash
# 1) Open Chrome, run each step, record locators
node .github/skills/feature-to-wdio-page-objects/scripts/drive-feature.mjs \
  --feature features/login.feature \
  --project-root . \
  --out .pom-discover \
  --locator-attribute test-automation-id \
  --base-url https://staging.example.com

# 2) Merge into page objects
node .github/skills/feature-to-wdio-page-objects/scripts/merge-page-object.mjs \
  --locators .pom-discover/locators.json \
  --project-root . \
  --page-object pageobjects/login.page.ts
```

Outputs:

| File | Purpose |
|------|---------|
| `.pom-discover/trace.json` | Full step execution record |
| `.pom-discover/gaps.json` | Missing attribute / ambiguous / unsupported steps |
| `.pom-discover/locators.json` | Locators grouped by page key for merge |

The driver walks steps in order: login (username + password + submit from a data table), then `I enter my name`, `I click submit`, and so on — each action is performed in Chrome before the locator is saved.

## Locator policy

- Every selector is rooted at `[<locatorAttribute>="…"]`
- If the control lacks the attribute but an ancestor has it, the getter uses **ancestor + relative child CSS**:

```ts
get loginUsernameFieldInput () {
    return $('[test-automation-id="login-username-field"] input')
}
```

- No `#id`, class-only, text, or free XPath roots

## Example Copilot prompts

```text
Using feature-to-wdio-page-objects: run features/checkout.feature against this
WDIO project with locator attribute test-automation-id. Merge locators into
pageobjects/checkout.page.ts. Summarize gaps without pasting the feature file.
```

```text
Generate WDIO page object locators from features/login.feature. Use attribute
data-qa. Create or merge files under pageobjects/. Locators only.
```

```text
Update pageobjects/settings.page.ts from features/settings.feature using the
feature-to-wdio-page-objects skill. Strict attribute test-automation-id with
ancestor+child paths.
```

## Skill package layout

```text
.github/skills/feature-to-wdio-page-objects/
├── SKILL.md
├── config.example.json
├── examples/login.page.ts
├── templates/page.ts.hbs
└── scripts/
    ├── drive-feature.mjs
    ├── resolve-locator.mjs
    ├── merge-page-object.mjs
    └── lib/
```

## v1 scope

**In:** browser-driven UI steps, strict attribute locators, create/merge TS getters, gap report  

**Out:** step definition generation, deleting unused getters, non-attribute fallbacks, Appium

## License

Use and adapt within your organization as needed. Review scripts before setting Copilot `allowed-tools: shell`.
# AutomationSkills_GithubCopilot
