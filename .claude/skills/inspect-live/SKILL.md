---
name: inspect-live
description: Launch VS Code with GitLens via Playwright and inspect the running extension — read UI text, check feature flags, read logs, take screenshots
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
| `rebuild_and_reload` | Build extension + reload VS Code window                |

### Typical Workflow

1. Call `launch` (once per session — takes ~10s)
2. Call `execute_command` to open the view you want to inspect
3. Call `screenshot` to see the current state (returns inline image)
4. Make code changes, then call `rebuild_and_reload` (~10-30s)
5. Call `screenshot` again to verify changes
6. Repeat steps 4-5 as needed
7. Call `teardown` when done

### Quick Example

```
launch { with_evaluator: true }
execute_command { command: "gitlens.showHomeView" }
screenshot { target: "webview", webview_title: "Home" }
inspect_dom { selector: "h1", in_webview: true }
rebuild_and_reload { build_command: "pnpm run build:extension" }
screenshot {}
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

1. **Build the extension first**: `pnpm run build:extension`
2. **Determine VS Code variant**: Ask the user whether they use VS Code Stable or Insiders, or check which is installed. Pass `--flavor insiders` if needed. If on WSL/SSH/headless Linux, use `--download-vscode` instead. Remember the user's preference in memory for future invocations.
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
