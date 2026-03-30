---
name: inspect-live
description: Launch VS Code with GitLens via Playwright and inspect the running extension — read UI text, check feature flags, read logs, take screenshots
---

# /inspect-live — Live Extension Inspection

Launch a real VS Code instance with GitLens loaded, then inspect UI elements, read logs, interact with views, and evaluate runtime values — all programmatically via Playwright.

## The Script

`scripts/e2e-dev-inspect.mjs` — a general-purpose CLI that supports ordered, repeatable actions.

### Two Modes

| Mode                  | Flag               | ExtensionMode | `container.debugging` | `gitkraken.env` | `evaluate()` |
| --------------------- | ------------------ | ------------- | --------------------- | --------------- | ------------ |
| Development (default) | _(none)_           | Development   | `true`                | ✅ respected    | ❌           |
| Test                  | `--with-evaluator` | Test          | `false`               | ❌ ignored      | ✅           |

Use **Development mode** when you need `gitkraken.env` (e.g. testing feature flags against dev API).
Use **Test mode** when you need `evaluate()` to inspect runtime values (e.g. `vscode.env.machineId`).

## Common Recipes

### Inspect any view's DOM content

```bash
node scripts/e2e-dev-inspect.mjs --command gitlens.showWelcomeView --query-frame h1
```

The `--query-frame` action searches all frames (including nested webview iframes) for matching elements and prints their text content.

### Get the full accessibility tree of a view

```bash
node scripts/e2e-dev-inspect.mjs --command gitlens.showHomeView --aria
```

### Inspect a specific DOM element

```bash
node scripts/e2e-dev-inspect.mjs --command gitlens.showWelcomeView --aria-selector "[class*='header']"
```

### Click something, then inspect the result

```bash
node scripts/e2e-dev-inspect.mjs \
  --command gitlens.showHomeView \
  --click-frame "button.start-work" \
  --pause 2000 \
  --query-frame ".dialog-content h2"
```

### Read runtime values (requires --with-evaluator)

```bash
node scripts/e2e-dev-inspect.mjs --with-evaluator \
  --eval "vscode.env.machineId" \
  --eval "vscode.version" \
  --eval "vscode.env.appName"
```

### Check feature flag behavior with dev environment

```bash
node scripts/e2e-dev-inspect.mjs --env dev \
  --command gitlens.showWelcomeView \
  --query-frame h1 \
  --logs FeatureFlagService
```

### Search extension logs for any pattern

```bash
node scripts/e2e-dev-inspect.mjs --logs "error"
node scripts/e2e-dev-inspect.mjs --env dev --logs ConfigCat
```

### Take a screenshot

```bash
node scripts/e2e-dev-inspect.mjs --command gitlens.showGraphView --screenshot /tmp/graph.png
```

### Keep VS Code open for manual interaction

```bash
node scripts/e2e-dev-inspect.mjs --env dev --keep-open
```

### Add custom settings

```bash
node scripts/e2e-dev-inspect.mjs \
  --setting "gitlens.currentLine.enabled=true" \
  --setting "gitlens.hovers.currentLine.over=line" \
  --command gitlens.showWelcomeView --aria
```

## How AI Agents Should Use This

1. **Build the extension first**: `pnpm run build:extension`
2. **Determine VS Code variant**: Ask the user whether they use VS Code Stable or Insiders, or check which is installed. Pass `--flavor insiders` if needed. Remember the user's preference in memory for future invocations.
3. **Run the script** with appropriate actions — all output goes to stdout as structured text
4. **Parse the output**:
   - `>>> query-frame: h1` → followed by element text content
   - `>>> aria snapshot` → YAML-like accessibility tree with roles, names, states
   - `>>> eval:` → followed by `Result: <JSON>`
   - `>>> logs` → followed by matching log lines

### Choosing the right action

| I want to...                         | Action                           |
| ------------------------------------ | -------------------------------- |
| Read text from a webview             | `--query-frame <selector>`       |
| See all UI elements and their states | `--aria`                         |
| Find a specific element              | `--aria-selector <css>`          |
| Read text from the main VS Code UI   | `--query <selector>`             |
| Click a button/link in a webview     | `--click-frame <selector>`       |
| Click in the main VS Code UI         | `--click <selector>`             |
| Read a runtime value                 | `--with-evaluator --eval "expr"` |
| Execute a VS Code command            | `--command <id>`                 |
| Check extension logs                 | `--logs <pattern>`               |

## All Options

| Flag                          | Description                                      |
| ----------------------------- | ------------------------------------------------ |
| `--env <env>`                 | Set `gitkraken.env` (e.g. `dev`, `staging`)      |
| `--with-evaluator`            | Enable HTTP evaluator bridge (Test mode)         |
| `--keep-open`                 | Keep VS Code running (Ctrl+C to stop)            |
| `--setting <key=value>`       | Custom VS Code setting (repeatable)              |
| `--wait <ms>`                 | Default wait between actions (default 3000)      |
| `--activation-wait <ms>`      | Wait time for GitLens activation (default 8000)  |
| `--workspace <path>`          | Path to open as workspace                        |
| `--vscode-path <path>`        | Path to VS Code Electron binary                  |
| `--flavor <stable\|insiders>` | VS Code variant to auto-detect (default: stable) |
| `--command <cmd>`             | Execute VS Code command                          |
| `--aria`                      | Print full window aria snapshot                  |
| `--aria-selector <sel>`       | Print aria snapshot of specific element          |
| `--query <sel>`               | Print textContent matching selector              |
| `--query-frame <sel>`         | Search all frames for selector                   |
| `--click <sel>`               | Click element                                    |
| `--click-frame <sel>`         | Click inside webview iframe                      |
| `--screenshot <path>`         | Save screenshot                                  |
| `--logs [pattern]`            | Search extension logs                            |
| `--eval <expr>`               | Evaluate JS expression in extension host         |
| `--pause <ms>`                | Wait specified duration                          |
