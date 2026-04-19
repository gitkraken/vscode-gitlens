---
name: live-inspect
description: Use when you need to visually inspect, interact with, or debug the running GitLens extension in VS Code — examining UI state, reading logs, checking feature flags, or verifying code changes against the live product
---

# /live-inspect — Live Extension Inspection

Launch a real VS Code instance with GitLens loaded, then inspect UI elements, read logs, interact with views, and evaluate runtime values — all programmatically via Playwright.

## MCP Server (Preferred for Iterative Inspection)

The `vscode-inspector` MCP server provides a **persistent, interactive** session. It launches VS Code once and exposes tools for screenshot/click/inspect/rebuild cycles — much faster than the batch CLI for agentic feedback loops.

The server is auto-discovered via `.mcp.json` when Claude Code starts in this repo. When connected, these MCP tools are available:

| Tool                  | Purpose                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `launch`              | Start VS Code with GitLens loaded (persistent session)             |
| `teardown`            | Close VS Code and clean up                                         |
| `get_status`          | Check if session is running                                        |
| `screenshot`          | Capture window or webview as inline image (capped at 1920px)       |
| `execute_command`     | Run any VS Code command by ID                                      |
| `click`               | Click element by CSS selector (main UI or webview)                 |
| `type_text`           | Type text into inputs                                              |
| `press_key`           | Press keyboard shortcuts                                           |
| `inspect_dom`         | Query DOM elements for text/HTML/attributes/shadowDOM              |
| `aria_snapshot`       | Get accessibility tree as YAML (supports webview iframes)          |
| `evaluate`            | Run JS in extension host with vscode API                           |
| `evaluate_in_webview` | Run JS in webview renderer (DOM, shadow DOM, computed styles)      |
| `list_webviews`       | Discover all open webviews with titles, dimensions, content status |
| `wait_for_webview`    | Wait for a webview to finish loading and Lit hydration             |
| `read_logs`           | Search extension output logs                                       |
| `read_console`        | Read browser console messages/errors from the main process         |
| `resize_viewport`     | Resize VS Code window viewport for responsive testing              |
| `rebuild_and_reload`  | Build extension + restart extension host                           |

### Typical Workflow

1. Call `launch` (once per session — takes ~10s)
2. Call `execute_command` to open the view you want to inspect
3. Call `list_webviews` to discover open webviews and their exact titles
4. Call `wait_for_webview { webview_title: "<title>" }` to wait for Lit hydration
5. Call `screenshot { target: "webview", webview_title: "<title>" }` or `aria_snapshot { webview_title: "<title>" }` to see the current state
6. Make code changes, then rebuild and reload (see below)
7. Call `screenshot` again to verify changes
8. Repeat steps 6-7 as needed
9. Call `teardown` when done

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

| I want to...                           | MCP tool                                                    | CLI flag                         |
| -------------------------------------- | ----------------------------------------------------------- | -------------------------------- |
| Discover open webviews                 | `list_webviews`                                             | _(N/A)_                          |
| Wait for a webview to load             | `wait_for_webview`                                          | _(N/A)_                          |
| Read text from a webview               | `inspect_dom` with `in_webview: true`                       | `--query-frame <selector>`       |
| See all UI elements and their states   | `aria_snapshot` with `in_webview: true`                     | `--aria`                         |
| Inspect Lit shadow DOM content         | `inspect_dom` with `property: "shadowDOM"` and `in_webview` | _(N/A)_                          |
| Run JS in a webview (DOM/styles/state) | `evaluate_in_webview`                                       | _(N/A)_                          |
| Read text from the main VS Code UI     | `inspect_dom`                                               | `--query <selector>`             |
| Click a button/link in a webview       | `click` with `in_webview: true`                             | `--click-frame <selector>`       |
| Read a runtime value (extension host)  | `evaluate`                                                  | `--with-evaluator --eval "expr"` |
| Execute a VS Code command              | `execute_command`                                           | `--command <id>`                 |
| Check extension logs                   | `read_logs`                                                 | `--logs <pattern>`               |
| Check main process console errors      | `read_console { level: "error" }`                           | _(N/A)_                          |
| See what the UI looks like             | `screenshot`                                                | `--screenshot <path>`            |
| Test responsive layout                 | `resize_viewport`                                           | _(N/A)_                          |

### GitLens Webview Reference

| Command                         | Webview Title        | Root Element            | Refresh Command                       |
| ------------------------------- | -------------------- | ----------------------- | ------------------------------------- |
| `gitlens.showHomeView`          | Home                 | `gl-home-app`           | `gitlens.views.home.refresh`          |
| `gitlens.showWelcomeView`       | Welcome              | `gl-welcome-page`       | _(N/A)_                               |
| `gitlens.showGraphPage`         | Commit Graph         | `gl-graph-app`          | `gitlens.graph.refresh`               |
| `gitlens.showGraphView`         | Commit Graph         | `gl-graph-app`          | `gitlens.views.graph.refresh`         |
| `gitlens.showCommitDetailsView` | Inspect              | `gl-commit-details-app` | `gitlens.views.commitDetails.refresh` |
| _(sidebar)_                     | Commit Graph Inspect | `gl-commit-details-app` | `gitlens.views.graphDetails.refresh`  |
| `gitlens.showTimelinePage`      | Visual History       | `gl-timeline-app`       | `gitlens.timeline.refresh`            |
| `gitlens.showTimelineView`      | Visual File History  | `gl-timeline-app`       | `gitlens.views.timeline.refresh`      |
| `gitlens.showComposerPage`      | Commit Composer      | `gl-composer-app`       | `gitlens.composer.refresh`            |
| `gitlens.showPatchDetailsPage`  | Patch                | `gl-patch-details-app`  | `gitlens.patchDetails.refresh`        |
| `gitlens.showSettingsPage`      | GitLens Settings     | `gl-settings-app`       | `gitlens.settings.refresh`            |

Root element tag convention: `gl-<name>-app`. Use these for `inspect_dom` selectors and `evaluate_in_webview` queries.

### Inspecting Webview Content

GitLens webviews use **Lit web components** with Shadow DOM. Here's the recommended approach:

1. **Discover**: `list_webviews` to find open webviews and their exact titles (or use the reference table above)
2. **Wait**: `wait_for_webview { webview_title: "Home" }` to ensure Lit hydration is complete
3. **Structure**: `aria_snapshot { webview_title: "Home" }` for the accessibility tree
4. **Shadow DOM**: `inspect_dom { selector: "gl-home-app", property: "shadowDOM", in_webview: true, webview_title: "Home" }` to see rendered Lit templates
5. **JS state**: `evaluate_in_webview { expression: "document.querySelector('gl-home-app').shadowRoot.querySelector('.my-element').textContent" }` to read shadow DOM content. Use `.shadowRoot.querySelector()` to reach elements inside Lit shadow roots — plain `document.querySelector()` cannot cross shadow boundaries.
6. **Styles**: `evaluate_in_webview { expression: "getComputedStyle(document.querySelector('gl-home-app').shadowRoot.querySelector('.my-element')).color" }` for computed styles
7. **Errors**: `read_console { level: "error" }` to check for JS errors in the main process. For webview-specific errors, use `evaluate_in_webview` to inspect state directly.

### Screenshot Best Practices

**Always target a specific webview** instead of taking full-window screenshots:

```
screenshot { target: "webview", webview_title: "Home" }
```

This captures just the webview content instead of the entire VS Code window. All screenshots are automatically capped at 1920px to stay within Claude's 2000px multi-image limit — no configuration needed.

Use `resize_viewport` if you need a specific window size for responsive testing.

### Troubleshooting

**Webview frame access fails / "not found" errors**: Try `launch { disable_site_isolation: true }`. This disables OOPIF site isolation so Playwright can access webview iframes directly. Note: CORS/CSP are also disabled, so webview behavior may differ slightly from production.

**Headless screenshots too small**: Use `launch { screen_resolution: "2560x1440x24" }` for a larger Xvfb display (default: 1920x1080x24).

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

## Related skills

- `/live-exercise` — the iterative working rhythm for UI-bearing work, which uses this skill's tools as its primitive. Use `/live-exercise` when touching UI; use this skill on its own for one-off inspection.
