---
name: inspect-live
description: Use when you need to visually inspect, interact with, or debug the running GitLens extension in VS Code — examining UI state, reading logs, checking feature flags, or verifying code changes against the live product
---

# /inspect-live — Live Extension Inspection

Launch a real VS Code instance with GitLens loaded, then inspect UI elements, read logs, interact with views, and evaluate runtime values — all programmatically via Playwright.

## MCP Server (Preferred for Iterative Inspection)

The `vscode-inspector` MCP server provides a **persistent, interactive** session. It launches VS Code once and exposes tools for screenshot/click/inspect/rebuild cycles — much faster than the batch CLI for agentic feedback loops.

The server is auto-discovered via `.mcp.json` when Claude Code starts in this repo. When connected, these MCP tools are available:

| Tool                 | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `launch`             | Start VS Code with GitLens loaded (persistent session) |
| `teardown`           | Close VS Code and clean up                             |
| `get_status`         | Check if session is running                            |
| `screenshot`         | Capture window or webview as inline image              |
| `execute_command`    | Run any VS Code command by ID                          |
| `click`              | Click element by CSS selector (main UI or webview)     |
| `type_text`          | Type text into inputs                                  |
| `press_key`          | Press keyboard shortcuts                               |
| `inspect_dom`        | Query DOM elements for text/HTML/attributes            |
| `aria_snapshot`      | Get accessibility tree as YAML                         |
| `evaluate`           | Run JS in extension host with vscode API               |
| `read_logs`          | Search extension output logs                           |
| `rebuild_and_reload` | Build extension + restart extension host               |

### Typical Workflow

1. Call `launch` (once per session — takes ~10s)
2. Call `execute_command` to open the view you want to inspect
3. Call `screenshot` to see the current state (returns inline image)
4. Make code changes, then rebuild and reload (see below)
5. Call `screenshot` again to verify changes
6. Repeat steps 4-5 as needed
7. Call `teardown` when done

### Rebuilding After Code Changes

**Extension host code** (commands, providers, services, models, parsers — anything under `src/` outside `src/webviews/apps/`):

```
rebuild_and_reload { build_command: "pnpm run build:extension" }
```

This restarts the extension host with the new code. All tools continue to work on the same VS Code instance.

**Webview code** (Lit components, CSS, templates under `src/webviews/apps/`): No extension host restart needed. Build the webviews, then use the view's refresh command:

```
rebuild_and_reload { build_command: "pnpm run build:webviews" }
execute_command { command: "gitlens.views.home.refresh" }
```

Every GitLens webview has a `gitlens.views.<name>.refresh` command (e.g. `gitlens.views.welcome.refresh`, `gitlens.views.graph.refresh`, `gitlens.views.commitDetails.refresh`). These fully reload the webview with fresh JS/CSS.

**Both changed**: Use `pnpm run build:quick` (builds extension + webviews, no linting), then refresh the relevant view.

### Quick Examples

Extension host code change:

```
launch {}
execute_command { command: "gitlens.showHomeView" }
screenshot {}
# ... edit extension host code ...
rebuild_and_reload { build_command: "pnpm run build:extension" }
screenshot {}
teardown
```

Webview code change:

```
launch {}
execute_command { command: "gitlens.showWelcomeView" }
inspect_dom { selector: "h1", in_webview: true }
# ... edit webview code ...
rebuild_and_reload { build_command: "pnpm run build:webviews" }
execute_command { command: "gitlens.views.welcome.refresh" }
inspect_dom { selector: "h1", in_webview: true }
teardown
```

## Batch CLI (Fallback for One-Shot Inspection)

`scripts/e2e-dev-inspect.mjs` — a general-purpose CLI that supports ordered, repeatable actions. Use this when the MCP server is not available or for quick one-off inspections.

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

## WSL / SSH / Headless Linux

If VS Code is not installed natively in your Linux environment, use `--download-vscode`
to download a portable binary. Xvfb is started automatically if no `$DISPLAY` is set.

```bash
node scripts/e2e-dev-inspect.mjs --download-vscode --command gitlens.showHomeView --aria
```

Requires `xvfb` package for headless environments: `sudo apt-get install xvfb`

## How AI Agents Should Use This

**Prefer the MCP server** for iterative work. Call `launch` once (use `download_vscode: true` on WSL/SSH/headless Linux), then use tools in a loop. No output parsing needed — tools return structured results directly.

### Choosing the right tool

| I want to...                         | MCP tool                              | CLI flag                         |
| ------------------------------------ | ------------------------------------- | -------------------------------- |
| Read text from a webview             | `inspect_dom` with `in_webview: true` | `--query-frame <selector>`       |
| See all UI elements and their states | `aria_snapshot`                       | `--aria`                         |
| Read text from the main VS Code UI   | `inspect_dom`                         | `--query <selector>`             |
| Click a button/link in a webview     | `click` with `in_webview: true`       | `--click-frame <selector>`       |
| Read a runtime value                 | `evaluate`                            | `--with-evaluator --eval "expr"` |
| Execute a VS Code command            | `execute_command`                     | `--command <id>`                 |
| Check extension logs                 | `read_logs`                           | `--logs <pattern>`               |
| See what the UI looks like           | `screenshot`                          | `--screenshot <path>`            |

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
| `--download-vscode`           | Download a portable VS Code binary (WSL/SSH/CI)  |
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
