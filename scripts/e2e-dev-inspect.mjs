#!/usr/bin/env node
/**
 * General-purpose tool for launching VS Code with GitLens and inspecting it
 * via Playwright. Supports two modes:
 *
 *   Development mode (default):
 *     - ExtensionMode.Development → container.debugging=true
 *     - gitkraken.env setting is respected (dev/staging APIs)
 *     - Inspection via aria snapshots, DOM queries, frame traversal
 *
 *   Test mode (--with-evaluator):
 *     - Enables the HTTP test runner bridge for evaluate() access
 *     - Can call vscode.* APIs, read variables, execute arbitrary code
 *     - Trade-off: container.debugging=false, gitkraken.env ignored
 *
 * Usage:
 *   node scripts/e2e-dev-inspect.mjs [options] [actions...]
 *
 * Options:
 *   --env <env>              Set gitkraken.env (e.g. "dev", "staging")
 *   --with-evaluator         Enable HTTP evaluator bridge (Test mode)
 *   --keep-open              Keep VS Code running (Ctrl+C to stop)
 *   --setting <key=value>    Add a custom VS Code setting (repeatable)
 *   --wait <ms>              Default wait between actions (default 3000)
 *   --activation-wait <ms>  Wait time for GitLens activation (default 8000)
 *   --workspace <path>       Path to open as workspace (default: extension root)
 *   --vscode-path <path>     Path to VS Code Electron binary (auto-detected)
 *   --download-vscode        Download a portable VS Code binary (for WSL/SSH/CI)
 *   --flavor <stable|insiders>  VS Code variant to use (default: stable)
 *
 * Actions (executed in order, repeatable):
 *   --command <cmd>           Execute a VS Code command via command palette
 *   --aria                    Print aria snapshot of the full VS Code window
 *   --aria-selector <sel>     Print aria snapshot of a specific CSS selector
 *   --query <sel>             Print textContent of elements matching CSS selector
 *   --query-frame <sel>       Search all frames (including webview iframes) for selector
 *   --click <sel>             Click an element matching CSS selector
 *   --click-frame <sel>       Click inside a webview iframe
 *   --screenshot <path>       Save a screenshot
 *   --logs [pattern]          Search extension logs (default pattern: all GitLens)
 *   --eval <expr>             Evaluate a JS expression in extension host (requires --with-evaluator)
 *   --pause <ms>              Wait for a specified duration
 *
 * Examples:
 *   # Inspect the welcome view heading
 *   node scripts/e2e-dev-inspect.mjs --command gitlens.showWelcomeView --query-frame h1
 *
 *   # Read a runtime value via the evaluator bridge
 *   node scripts/e2e-dev-inspect.mjs --with-evaluator \
 *     --eval "vscode.env.machineId"
 *
 *   # Click through UI, inspect result
 *   node scripts/e2e-dev-inspect.mjs \
 *     --command gitlens.showWelcomeView \
 *     --pause 2000 \
 *     --aria-selector "[aria-label*='Home']" \
 *     --screenshot /tmp/after-click.png
 *
 *   # Check feature flag logs with dev env
 *   node scripts/e2e-dev-inspect.mjs --env dev --logs FeatureFlagService
 *
 *   # Keep open for manual inspection
 *   node scripts/e2e-dev-inspect.mjs --env dev --keep-open
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '..');

// --- Argument parsing -------------------------------------------------------
function parseArgs(argv) {
	const opts = {
		env: undefined,
		withEvaluator: false,
		keepOpen: false,
		downloadVSCode: false,
		settings: {},
		wait: 3000,
		activationWait: 8000,
		workspace: extensionRoot,
		vscodePath: undefined,
		flavor: 'stable',
		actions: [],
	};
	function requireArg(argv, i, flag) {
		const val = argv[i];
		if (val === undefined || val.startsWith('--')) {
			console.error(`Missing required value for ${flag}`);
			process.exit(1);
		}
		return val;
	}

	for (let i = 2; i < argv.length; i++) {
		switch (argv[i]) {
			case '--env':
				opts.env = requireArg(argv, ++i, '--env');
				break;
			case '--with-evaluator':
				opts.withEvaluator = true;
				break;
			case '--keep-open':
				opts.keepOpen = true;
				break;
			case '--download-vscode':
				opts.downloadVSCode = true;
				break;
			case '--wait': {
				const val = Number(requireArg(argv, ++i, '--wait'));
				if (!Number.isFinite(val) || val < 0) {
					console.error(`Invalid --wait value: ${argv[i]}`);
					process.exit(1);
				}
				opts.wait = val;
				break;
			}
			case '--activation-wait': {
				const raw = requireArg(argv, ++i, '--activation-wait');
				const ms = Number(raw);
				if (!Number.isFinite(ms) || ms < 0) {
					console.error(`Invalid --activation-wait value: "${raw}". Expected non-negative milliseconds.`);
					process.exit(1);
				}
				opts.activationWait = ms;
				break;
			}
			case '--workspace':
				opts.workspace = requireArg(argv, ++i, '--workspace');
				break;
			case '--vscode-path':
				opts.vscodePath = requireArg(argv, ++i, '--vscode-path');
				break;
			case '--flavor': {
				const val = requireArg(argv, ++i, '--flavor');
				if (val !== 'stable' && val !== 'insiders') {
					console.error(`Invalid --flavor value: "${val}". Expected "stable" or "insiders".`);
					process.exit(1);
				}
				opts.flavor = val;
				break;
			}
			case '--setting': {
				const raw = requireArg(argv, ++i, '--setting');
				if (!raw.includes('=') || raw.startsWith('=')) {
					console.error(`Invalid --setting value: "${raw}". Expected key=value format.`);
					process.exit(1);
				}
				const [k, ...v] = raw.split('=');
				let settingValue = v.join('=');
				if (settingValue === 'true') settingValue = true;
				else if (settingValue === 'false') settingValue = false;
				else if (settingValue !== '' && !isNaN(Number(settingValue))) settingValue = Number(settingValue);
				opts.settings[k] = settingValue;
				break;
			}
			// Actions (order-preserving)
			case '--command':
				opts.actions.push({ type: 'command', value: requireArg(argv, ++i, '--command') });
				break;
			case '--aria':
				opts.actions.push({ type: 'aria' });
				break;
			case '--aria-selector':
				opts.actions.push({ type: 'aria-selector', value: requireArg(argv, ++i, '--aria-selector') });
				break;
			case '--query':
				opts.actions.push({ type: 'query', value: requireArg(argv, ++i, '--query') });
				break;
			case '--query-frame':
				opts.actions.push({ type: 'query-frame', value: requireArg(argv, ++i, '--query-frame') });
				break;
			case '--click':
				opts.actions.push({ type: 'click', value: requireArg(argv, ++i, '--click') });
				break;
			case '--click-frame':
				opts.actions.push({ type: 'click-frame', value: requireArg(argv, ++i, '--click-frame') });
				break;
			case '--screenshot':
				opts.actions.push({ type: 'screenshot', value: requireArg(argv, ++i, '--screenshot') });
				break;
			case '--logs': {
				const next = argv[i + 1];
				const hasVal = next && !next.startsWith('--');
				opts.actions.push({ type: 'logs', value: hasVal ? argv[++i] : 'GitLens' });
				break;
			}
			case '--eval':
				opts.actions.push({ type: 'eval', value: requireArg(argv, ++i, '--eval') });
				break;
			case '--pause': {
				const val = Number(requireArg(argv, ++i, '--pause'));
				if (!Number.isFinite(val) || val < 0) {
					console.error(`Invalid --pause value: ${argv[i]}`);
					process.exit(1);
				}
				opts.actions.push({ type: 'pause', value: val });
				break;
			}
			default:
				console.error(`Unknown option: ${argv[i]}`);
				process.exit(1);
		}
	}
	return opts;
}

// --- VS Code auto-detection -------------------------------------------------
const vscodePaths = {
	stable: [
		// macOS
		'/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
		`${os.homedir()}/Applications/Visual Studio Code.app/Contents/MacOS/Electron`,
		// Linux — Electron binaries (not wrapper scripts like /usr/bin/code)
		'/usr/share/code/code',
		`${os.homedir()}/.local/share/code/code`,
		'/snap/code/current/usr/share/code/code',
	],
	insiders: [
		// macOS
		'/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron',
		`${os.homedir()}/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron`,
		// Linux
		'/usr/share/code-insiders/code-insiders',
		`${os.homedir()}/.local/share/code-insiders/code-insiders`,
		'/snap/code-insiders/current/usr/share/code-insiders/code-insiders',
	],
};

function getWindowsPaths(flavor) {
	const paths = [];
	if (flavor === 'stable' || flavor === undefined) {
		if (process.env.LOCALAPPDATA) paths.push(`${process.env.LOCALAPPDATA}/Programs/Microsoft VS Code/Code.exe`);
		if (process.env.ProgramFiles) paths.push(`${process.env.ProgramFiles}/Microsoft VS Code/Code.exe`);
	}
	if (flavor === 'insiders' || flavor === undefined) {
		if (process.env.LOCALAPPDATA)
			paths.push(`${process.env.LOCALAPPDATA}/Programs/Microsoft VS Code Insiders/Code - Insiders.exe`);
		if (process.env.ProgramFiles)
			paths.push(`${process.env.ProgramFiles}/Microsoft VS Code Insiders/Code - Insiders.exe`);
	}
	return paths;
}

function findVSCode(explicit, flavor = 'stable') {
	if (explicit) return explicit;

	// Search preferred flavor first, then fall back to the other
	const other = flavor === 'insiders' ? 'stable' : 'insiders';
	const candidates = [
		...vscodePaths[flavor],
		...getWindowsPaths(flavor),
		...vscodePaths[other],
		...getWindowsPaths(other),
	];

	for (const c of candidates) {
		if (existsSync(c)) return c;
	}
	throw new Error(
		'Could not find VS Code. Provide --vscode-path, install VS Code, or use --download-vscode to download a portable binary.',
	);
}

// --- Default settings -------------------------------------------------------
const defaultSettings = {
	'telemetry.telemetryLevel': 'off',
	'workbench.tips.enabled': false,
	'workbench.startupEditor': 'none',
	'workbench.enableExperiments': false,
	'workbench.welcomePage.walkthroughs.openOnInstall': false,
	'extensions.ignoreRecommendations': true,
	'extensions.autoUpdate': false,
	'update.mode': 'none',
	'files.simpleDialog.enable': true,
	'window.dialogStyle': 'custom',
	'gitlens.outputLevel': 'debug',
	'gitlens.telemetry.enabled': false,
};

// --- Display handling for headless Linux (WSL/SSH) --------------------------
const XVFB_DISPLAY = ':99';
let xvfbProcess;

/**
 * Ensures a display server is available for Electron on Linux.
 * On non-Linux or when $DISPLAY is already set, this is a no-op.
 * On headless Linux (WSL, SSH), starts Xvfb if available.
 */
function ensureDisplay() {
	if (process.platform !== 'linux' || process.env.DISPLAY) {
		return process.env.DISPLAY;
	}

	try {
		execFileSync('which', ['Xvfb'], { stdio: 'ignore' });

		// Check if Xvfb is already running on our display
		try {
			execFileSync('xdpyinfo', ['-display', XVFB_DISPLAY], { stdio: 'ignore' });
			return XVFB_DISPLAY;
		} catch {
			// Not running, start it
		}

		xvfbProcess = spawn('Xvfb', [XVFB_DISPLAY, '-screen', '0', '1920x1080x24'], {
			detached: true,
			stdio: 'ignore',
		});
		xvfbProcess.unref();

		// Give Xvfb time to start
		execFileSync('sleep', ['0.5']);

		return XVFB_DISPLAY;
	} catch {
		return undefined;
	}
}

// --- Log searching ----------------------------------------------------------
async function findLogs(dir, pattern, depth = 0) {
	if (depth > 5) return [];
	const results = [];
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) results.push(...(await findLogs(full, pattern, depth + 1)));
			else if (entry.name.endsWith('.log') || entry.name.includes('output')) {
				try {
					const c = await readFile(full, 'utf8');
					results.push(
						...c
							.split('\n')
							.filter(l => l.includes(pattern))
							.map(l => l.trim()),
					);
				} catch (e) {
					/* ignore unreadable log files */
				}
			}
		}
	} catch (e) {
		/* ignore inaccessible directories */
	}
	return results;
}

// --- Frame helpers ----------------------------------------------------------
async function queryAllFrames(page, selector, action = 'text') {
	const results = [];
	// Main page
	try {
		const els = page.locator(selector);
		const count = await els.count();
		for (let i = 0; i < count; i++) {
			if (action === 'click') {
				await els.nth(i).click({ timeout: 2000 });
				results.push({ frame: 'main', text: '(clicked)' });
				return results;
			} else {
				const text = await els
					.nth(i)
					.textContent({ timeout: 1000 })
					.catch(() => null);
				if (text?.trim()) results.push({ frame: 'main', text: text.trim() });
			}
		}
	} catch {}
	// All subframes (webview iframes)
	for (const frame of page.frames()) {
		const url = frame.url();
		if (url === 'about:blank' || url === page.url()) continue;
		try {
			const els = frame.locator(selector);
			const count = await els.count();
			for (let i = 0; i < count; i++) {
				if (action === 'click') {
					await els.nth(i).click({ timeout: 2000 });
					results.push({ frame: url.substring(0, 80), text: '(clicked)' });
					return results;
				} else {
					const text = await els
						.nth(i)
						.textContent({ timeout: 1000 })
						.catch(() => null);
					if (text?.trim()) results.push({ frame: url.substring(0, 80), text: text.trim() });
				}
			}
		} catch {}
	}
	return results;
}

// --- Evaluator connect (Test mode only) ------------------------------------
// Inlined from tests/e2e/fixtures/vscodeEvaluator.ts to avoid TypeScript build dependency
async function connectEvaluator(electronApp) {
	// Access Playwright internals to get the Electron process stderr
	const connection = electronApp._connection;
	const impl = connection.toImpl(electronApp);
	const proc = impl._process;
	const serverRegex = /VSCodeTestServer listening on (http:\/\/[^\s]+)/;

	// Check recent logs first
	const recentLogs = impl._nodeConnection?._browserLogsCollector?.recentLogs() ?? [];
	let match = recentLogs.map(s => s.match(serverRegex)).find(Boolean);

	if (!match) {
		// Wait for server URL from stderr (mirrors vscodeEvaluator.ts waitForLine pattern)
		const readline = await import('node:readline');
		match = await new Promise((resolve, reject) => {
			const rl = readline.createInterface({ input: proc.stderr });
			const listeners = [];

			function addListener(emitter, event, handler) {
				emitter.on(event, handler);
				listeners.push({ emitter, event, handler });
			}

			function cleanup() {
				clearTimeout(timer);
				for (const l of listeners) {
					l.emitter.removeListener(l.event, l.handler);
				}
				listeners.length = 0;
				rl.close();
			}

			const timer = setTimeout(() => {
				cleanup();
				reject(new Error('Timeout waiting for VSCodeTestServer'));
			}, 30000);

			addListener(rl, 'line', line => {
				const m = line.match(serverRegex);
				if (m) {
					cleanup();
					resolve(m);
				}
			});

			addListener(proc, 'exit', () => {
				cleanup();
				reject(new Error('Process exited'));
			});

			addListener(proc, 'error', err => {
				cleanup();
				reject(err ?? new Error('Process error while waiting for VSCodeTestServer'));
			});

			addListener(rl, 'close', () => {
				cleanup();
				reject(new Error('Readline closed before VSCodeTestServer URL found'));
			});
		});
	}

	const serverUrl = match[1];
	return {
		async evaluate(fn, ...args) {
			const res = await fetch(`${serverUrl}/invoke`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fn: fn.toString(), params: args.length ? args : undefined }),
			});
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new Error(`Evaluator request failed (${res.status}): ${text}`);
			}
			const data = await res.json();
			if (data.error) {
				const err = new Error(data.error.message);
				if (data.error.stack) err.stack = data.error.stack;
				throw err;
			}
			return data.result;
		},
	};
}

// --- Main -------------------------------------------------------------------
async function main() {
	const opts = parseArgs(process.argv);

	let vscodePath;
	if (opts.downloadVSCode) {
		const { downloadAndUnzipVSCode } = await import('@vscode/test-electron/out/download.js');
		console.log('Downloading portable VS Code...');
		vscodePath = await downloadAndUnzipVSCode(opts.flavor === 'insiders' ? 'insiders' : 'stable');
	} else {
		vscodePath = findVSCode(opts.vscodePath, opts.flavor);
	}

	const { _electron } = await import('@playwright/test');

	// Temp directories
	const tempDir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gl-inspect-')));
	const userDataDir = path.join(tempDir, 'user-data');
	const settingsDir = path.join(userDataDir, 'User');
	await mkdir(settingsDir, { recursive: true });

	let electronApp;
	let cleaningUp = false;

	async function cleanup() {
		if (cleaningUp) return;
		cleaningUp = true;
		try {
			await electronApp?.close().catch(() => {});
		} finally {
			await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		}
	}

	try {
		// Write settings
		const settings = { ...defaultSettings, ...opts.settings };
		if (opts.env) settings['gitkraken.env'] = opts.env;
		await writeFile(path.join(settingsDir, 'settings.json'), JSON.stringify(settings, null, '\t'));

		// Build launch args
		const launchArgs = [
			'--no-sandbox',
			'--disable-gpu-sandbox',
			'--disable-updates',
			'--skip-welcome',
			'--skip-release-notes',
			'--disable-workspace-trust',
			`--extensionDevelopmentPath=${extensionRoot}`,
			`--extensions-dir=${path.join(tempDir, 'extensions')}`,
			`--user-data-dir=${userDataDir}`,
		];
		if (opts.withEvaluator) {
			const runnerPath = path.join(extensionRoot, 'tests', 'e2e', 'runner', 'dist');
			launchArgs.push(`--extensionTestsPath=${runnerPath}`);
		}
		launchArgs.push(opts.workspace);

		// Ensure E2E runner is built before launch (VS Code loads it during startup)
		if (opts.withEvaluator) {
			const runnerDistIndex = path.join(extensionRoot, 'tests', 'e2e', 'runner', 'dist', 'index.js');
			if (!existsSync(runnerDistIndex)) {
				console.log('Building E2E runner...');
				const { execSync } = await import('node:child_process');
				execSync('pnpm run build:e2e-runner', { cwd: extensionRoot, stdio: 'inherit' });
			}
		}

		const display = ensureDisplay();

		const mode = opts.withEvaluator ? 'Test (with evaluator)' : 'Development';
		console.log(`Launching VS Code in ${mode} mode...`);
		console.log(`  binary: ${vscodePath}`);
		if (display) console.log(`  display: ${display}`);
		if (opts.env) console.log(`  gitkraken.env: "${opts.env}"`);

		electronApp = await _electron.launch({
			executablePath: vscodePath,
			args: launchArgs,
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: undefined,
				...(display ? { DISPLAY: display } : {}),
			},
		});

		const page = await electronApp.firstWindow();

		// Connect evaluator early to avoid missing the VSCodeTestServer URL from stderr
		// (the URL is printed during launch, before activation completes)
		let evaluate = null;
		if (opts.withEvaluator) {
			const evaluator = await connectEvaluator(electronApp);
			evaluate = evaluator.evaluate.bind(evaluator);
			console.log('Evaluator bridge connected.');
		}

		console.log('Waiting for GitLens to activate...');
		await page.waitForTimeout(opts.activationWait);
		console.log('Ready.\n');

		// Execute actions in order
		for (const action of opts.actions) {
			switch (action.type) {
				case 'command': {
					console.log(`>>> command: ${action.value}`);
					if (evaluate) {
						await evaluate((vscode, cmd) => vscode.commands.executeCommand(cmd), action.value);
					} else {
						// Non-evaluator mode: opens command palette and types the value.
						// Both command IDs (e.g. "gitlens.showWelcomeView") and display titles
						// work here — VS Code's palette fuzzy-matches against both.
						await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
						await page.waitForTimeout(400);
						await page.keyboard.type(action.value, { delay: 20 });
						await page.waitForTimeout(800);
						await page.keyboard.press('Enter');
					}
					await page.waitForTimeout(opts.wait);
					break;
				}
				case 'aria': {
					console.log('>>> aria snapshot (full window)');
					console.log(await page.locator('body').ariaSnapshot());
					console.log();
					break;
				}
				case 'aria-selector': {
					console.log(`>>> aria snapshot: ${action.value}`);
					try {
						const el = page.locator(action.value).first();
						console.log(await el.ariaSnapshot({ timeout: 3000 }));
					} catch (e) {
						console.log(`  (not found: ${e.message})`);
					}
					console.log();
					break;
				}
				case 'query': {
					console.log(`>>> query: ${action.value}`);
					const els = page.locator(action.value);
					const count = await els.count();
					for (let i = 0; i < count; i++) {
						const text = await els
							.nth(i)
							.textContent({ timeout: 1000 })
							.catch(() => null);
						if (text?.trim()) console.log(`  [${i}] ${text.trim()}`);
					}
					console.log();
					break;
				}
				case 'query-frame': {
					console.log(`>>> query-frame: ${action.value}`);
					const results = await queryAllFrames(page, action.value);
					if (results.length === 0) console.log('  (no matches)');
					for (const r of results) console.log(`  "${r.text}" (in ${r.frame})`);
					console.log();
					break;
				}
				case 'click': {
					console.log(`>>> click: ${action.value}`);
					await page.locator(action.value).first().click({ timeout: 3000 });
					await page.waitForTimeout(opts.wait);
					break;
				}
				case 'click-frame': {
					console.log(`>>> click-frame: ${action.value}`);
					const results = await queryAllFrames(page, action.value, 'click');
					if (results.length === 0) console.log('  (no matches)');
					else console.log(`  Clicked ${results.length} element(s)`);
					await page.waitForTimeout(opts.wait);
					break;
				}
				case 'screenshot': {
					const p = path.resolve(action.value);
					await page.screenshot({ path: p, fullPage: true });
					console.log(`>>> screenshot saved: ${p}\n`);
					break;
				}
				case 'logs': {
					console.log(`>>> logs (pattern: "${action.value}")`);
					const logs = await findLogs(userDataDir, action.value);
					console.log(`  Found ${logs.length} matching lines:`);
					for (const line of logs) console.log(`  ${line.substring(0, 500)}`);
					console.log();
					break;
				}
				case 'eval': {
					if (!evaluate) {
						console.log('>>> eval: ERROR — requires --with-evaluator');
						break;
					}
					console.log(`>>> eval: ${action.value}`);
					try {
						const fn = new Function('vscode', `return (${action.value})`);
						const result = await evaluate(fn);
						console.log(`  Result: ${JSON.stringify(result)}`);
					} catch (e) {
						console.log(`  Error: ${e.message}`);
					}
					console.log();
					break;
				}
				case 'pause': {
					console.log(`>>> pause ${action.value}ms`);
					await page.waitForTimeout(action.value);
					break;
				}
			}
		}

		// Keep open or close
		if (opts.keepOpen) {
			console.log('VS Code is running. Press Ctrl+C to stop.');
			process.on('SIGINT', async () => {
				try {
					await cleanup();
				} finally {
					process.exit(0);
				}
			});
			await new Promise(resolve => {
				electronApp.on('close', resolve);
			});
			console.log('VS Code closed. Cleaning up...');
		} else {
			console.log('Done.');
		}
	} finally {
		await cleanup();
	}
}

main().catch(e => {
	console.error('Error:', e);
	process.exit(1);
});
