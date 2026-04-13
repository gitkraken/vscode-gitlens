#!/usr/bin/env node
/**
 * MCP server for agentic VS Code extension inspection.
 *
 * Provides a persistent Playwright/Electron session that agents can interact
 * with via MCP tools: launch VS Code, take screenshots, click elements,
 * inspect DOM, execute commands, and rebuild/reload — all on a single
 * long-lived VS Code instance.
 *
 * Designed to work with any VS Code extension. GitLens-specific defaults
 * are loaded from .vscode-agent.json if present.
 *
 * Usage (via .mcp.json):
 *   { "mcpServers": { "vscode-inspector": { "command": "node", "args": ["scripts/mcp-vscode-server.mjs"] } } }
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptRoot = path.resolve(__dirname, '..');

// =============================================================================
// Session state
// =============================================================================
let state = 'idle'; // idle | launching | ready
let electronApp = null;
let page = null;
let evaluateFn = null;
let tempDir = null;
let userDataDir = null;
let launchTime = null;
let sessionConfig = {};
let xvfbProcess = null;
let consoleBuffer = [];
const MAX_CONSOLE_ENTRIES = 500;

// =============================================================================
// Load optional .vscode-agent.json config
// =============================================================================
function loadAgentConfig(extensionPath) {
	const configPath = path.join(extensionPath, '.vscode-agent.json');
	if (existsSync(configPath)) {
		try {
			return JSON.parse(readFileSync(configPath, 'utf8'));
		} catch {
			return {};
		}
	}
	return {};
}

// =============================================================================
// VS Code auto-detection (from e2e-dev-inspect.mjs)
// =============================================================================
const vscodePaths = {
	stable: [
		'/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
		`${os.homedir()}/Applications/Visual Studio Code.app/Contents/MacOS/Electron`,
		'/usr/share/code/code',
		`${os.homedir()}/.local/share/code/code`,
		'/snap/code/current/usr/share/code/code',
	],
	insiders: [
		'/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron',
		`${os.homedir()}/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron`,
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
	throw new Error('Could not find VS Code. Pass vscode_path, install VS Code, or set download_vscode: true.');
}

// =============================================================================
// Display handling for headless Linux (WSL/SSH)
// =============================================================================
const XVFB_DISPLAY = ':99';

function ensureDisplay(screenResolution = '1920x1080x24') {
	if (process.platform !== 'linux' || process.env.DISPLAY) {
		return process.env.DISPLAY;
	}
	try {
		execFileSync('which', ['Xvfb'], { stdio: 'ignore' });
		try {
			execFileSync('xdpyinfo', ['-display', XVFB_DISPLAY], { stdio: 'ignore' });
			return XVFB_DISPLAY;
		} catch {
			// Not running, start it
		}
		xvfbProcess = spawn('Xvfb', [XVFB_DISPLAY, '-screen', '0', screenResolution], {
			detached: true,
			stdio: 'ignore',
		});
		xvfbProcess.unref();
		execFileSync('sleep', ['0.5']);
		return XVFB_DISPLAY;
	} catch {
		return undefined;
	}
}

// =============================================================================
// Log searching
// =============================================================================
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
				} catch {
					/* ignore unreadable log files */
				}
			}
		}
	} catch {
		/* ignore inaccessible directories */
	}
	return results;
}

// =============================================================================
// Frame helpers — search all frames including webview iframes
// =============================================================================

/**
 * Get webview content frameLocators by navigating the live DOM.
 *
 * VS Code webviews use nested iframes:
 *   outer iframe (vscode-webview://...) → inner iframe (#active-frame)
 *
 * After a refresh, VS Code replaces #active-frame with a new iframe.
 * Playwright's page.frames() keeps stale references to the old iframe,
 * but frameLocator('#active-frame') always resolves from the current DOM.
 *
 * Returns an array of { frameLocator, outerFrame } for each webview.
 */
function getWebviewFrameLocators(currentPage) {
	const locators = [];
	for (const frame of currentPage.frames()) {
		if (frame.isDetached()) continue;
		const url = frame.url();
		if (!url.startsWith('vscode-webview://')) continue;
		// This is a webview outer frame. The actual content is in #active-frame.
		const activeFrame = frame.frameLocator('#active-frame');
		locators.push({ frameLocator: activeFrame, outerFrame: frame, url });
	}
	return locators;
}

async function queryAllFrames(currentPage, selector, action = 'text') {
	const results = [];
	// Main page
	try {
		const els = currentPage.locator(selector);
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
	// Webview content via DOM-driven frameLocator (always resolves to live #active-frame)
	for (const { frameLocator, url } of getWebviewFrameLocators(currentPage)) {
		try {
			const els = frameLocator.locator(selector);
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
	// Fallback: also check non-webview subframes (e.g. extension editor iframes)
	for (const frame of currentPage.frames()) {
		if (frame.isDetached()) continue;
		const url = frame.url();
		if (url === 'about:blank' || url === currentPage.url() || url.startsWith('vscode-webview://')) continue;
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

// =============================================================================
// Evaluator connect — HTTP bridge to extension host
// =============================================================================
async function connectEvaluator(app, { skipCache = false } = {}) {
	const connection = app._connection;
	const impl = connection.toImpl(app);
	const proc = impl._process;
	const serverRegex = /VSCodeTestServer listening on (http:\/\/[^\s]+)/;

	let match;
	if (!skipCache) {
		const recentLogs = impl._nodeConnection?._browserLogsCollector?.recentLogs() ?? [];
		match = recentLogs.map(s => s.match(serverRegex)).find(Boolean);
	}

	if (!match) {
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
				for (const l of listeners) l.emitter.removeListener(l.event, l.handler);
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
				reject(err ?? new Error('Process error'));
			});
			addListener(rl, 'close', () => {
				cleanup();
				reject(new Error('Readline closed before VSCodeTestServer URL found'));
			});
		});
	}

	const serverUrl = match[1];
	return {
		serverUrl,
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

// =============================================================================
// Default VS Code settings (extension-agnostic base)
// =============================================================================
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
};

// =============================================================================
// Cleanup helper
// =============================================================================
let cleaningUp = false;
async function cleanup() {
	if (cleaningUp) return;
	cleaningUp = true;
	try {
		await electronApp?.close().catch(() => {});
	} finally {
		electronApp = null;
		page = null;
		evaluateFn = null;
		if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		tempDir = null;
		userDataDir = null;
		launchTime = null;
		consoleBuffer = [];
		state = 'idle';
		cleaningUp = false;
	}
}

// =============================================================================
// Helper: require ready state
// =============================================================================
function requireReady() {
	if (state !== 'ready' || !page) {
		throw new Error('No VS Code instance running. Call the "launch" tool first.');
	}
}

function textResult(text) {
	return { content: [{ type: 'text', text }] };
}

const MAX_SCREENSHOT_DIMENSION = 1920;

/**
 * Read PNG width/height from the IHDR chunk (bytes 16-23).
 */
function pngDimensions(buf) {
	if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
	if (buf.readUInt32BE(12) !== 0x49484452) return null; // Verify IHDR chunk
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Enforce the max dimension limit on screenshots. Downscales via sharp
 * (already a project dependency) so images never exceed the 2000px
 * multi-image limit in Claude conversations.
 */
async function enforceMaxDimension(buf) {
	const dims = pngDimensions(buf);
	if (!dims || (dims.width <= MAX_SCREENSHOT_DIMENSION && dims.height <= MAX_SCREENSHOT_DIMENSION)) return buf;
	const sharp = (await import('sharp')).default;
	return await sharp(buf)
		.resize({
			width: MAX_SCREENSHOT_DIMENSION,
			height: MAX_SCREENSHOT_DIMENSION,
			fit: 'inside',
			withoutEnlargement: true,
		})
		.png()
		.toBuffer();
}

async function imageResult(buffer) {
	const resized = await enforceMaxDimension(buffer);
	return {
		content: [{ type: 'image', data: resized.toString('base64'), mimeType: 'image/png' }],
	};
}

function errorResult(message) {
	return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

// =============================================================================
// Find webview frameLocator by title (returns the live #active-frame locator)
// =============================================================================
async function findWebviewFrameLocator(webviewTitle, extensionId) {
	requireReady();
	const webviews = getWebviewFrameLocators(page);

	for (const { frameLocator, outerFrame, url } of webviews) {
		// Filter by extension ID if provided
		if (
			extensionId &&
			!url.includes(`extensionId=${extensionId}`) &&
			!url.includes(encodeURIComponent(extensionId))
		) {
			continue;
		}
		// Check if the outer frame's title matches
		if (webviewTitle) {
			try {
				const title = await outerFrame.title().catch(() => '');
				if (title && title.toLowerCase().includes(webviewTitle.toLowerCase())) {
					return { frameLocator, outerFrame };
				}
			} catch {}
		}
	}
	// Fallback: return first webview with non-empty content (only when no title specified)
	if (!webviewTitle) {
		for (const entry of webviews) {
			try {
				const bodyText = await entry.frameLocator
					.locator('body')
					.textContent({ timeout: 500 })
					.catch(() => '');
				if (bodyText) return entry;
			} catch {}
		}
	}
	return null;
}

// =============================================================================
// MCP Server setup
// =============================================================================
const server = new McpServer({
	name: 'vscode-inspector',
	version: '0.1.0',
});

// --- launch ------------------------------------------------------------------
server.tool(
	'launch',
	'Launch VS Code with an extension loaded for inspection. Starts a persistent session.',
	{
		workspace_path: z.string().optional().describe('Path to open as workspace (default: extension root)'),
		extension_path: z.string().optional().describe('Path to the extension to load (default: cwd)'),
		extension_id: z.string().optional().describe('Extension ID for webview frame filtering'),
		settings: z.object({}).passthrough().optional().describe('VS Code settings to apply (merged with defaults)'),
		with_evaluator: z
			.boolean()
			.optional()
			.describe('Enable HTTP evaluator bridge for vscode API access (default: true)'),
		download_vscode: z.boolean().optional().describe('Download a portable VS Code binary (for WSL/SSH/CI)'),
		vscode_path: z.string().optional().describe('Explicit path to VS Code Electron binary'),
		activation_wait: z
			.number()
			.optional()
			.describe('Milliseconds to wait for extension activation (default: from config or 8000)'),
		flavor: z.enum(['stable', 'insiders']).optional().describe('VS Code variant (default: stable)'),
		screen_resolution: z
			.string()
			.optional()
			.describe('Xvfb screen resolution for headless Linux (e.g. "2560x1440x24", default: "1920x1080x24")'),
		disable_site_isolation: z
			.boolean()
			.optional()
			.describe(
				'Disable site isolation and web security (OOPIF workaround). Only use if webview frame access fails. Disables CORS/CSP — webviews may behave differently than production.',
			),
	},
	async args => {
		if (state === 'ready') {
			return errorResult('VS Code is already running. Call "teardown" first, or use "get_status" to check.');
		}
		if (state === 'launching') {
			return errorResult('VS Code is currently launching. Please wait.');
		}

		state = 'launching';
		try {
			const extensionPath = path.resolve(args.extension_path ?? process.cwd());
			const agentConfig = loadAgentConfig(extensionPath);
			const withEvaluator = args.with_evaluator ?? true;
			const flavor = args.flavor ?? 'stable';
			const activationWait = args.activation_wait ?? agentConfig.activationWait ?? 8000;
			const workspace = args.workspace_path ? path.resolve(args.workspace_path) : extensionPath;

			sessionConfig = {
				extensionPath,
				extensionId: args.extension_id ?? agentConfig.extensionId,
				withEvaluator,
			};

			// Resolve VS Code binary
			let vscodePath;
			if (args.download_vscode) {
				const { downloadAndUnzipVSCode } = await import('@vscode/test-electron/out/download.js');
				vscodePath = await downloadAndUnzipVSCode(flavor === 'insiders' ? 'insiders' : 'stable');
			} else {
				vscodePath = findVSCode(args.vscode_path, flavor);
			}

			const { _electron } = await import('@playwright/test');

			// Temp directories
			tempDir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vscode-agent-')));
			userDataDir = path.join(tempDir, 'user-data');
			const settingsDir = path.join(userDataDir, 'User');
			await mkdir(settingsDir, { recursive: true });

			// Write settings
			const settings = {
				...defaultSettings,
				...(agentConfig.settings ?? {}),
				...(args.settings ?? {}),
			};
			await writeFile(path.join(settingsDir, 'settings.json'), JSON.stringify(settings, null, '\t'));

			// Build launch args
			const launchArgs = [
				'--no-sandbox',
				'--disable-gpu-sandbox',
				'--disable-updates',
				'--skip-welcome',
				'--skip-release-notes',
				'--disable-workspace-trust',
				`--extensionDevelopmentPath=${extensionPath}`,
				`--extensions-dir=${path.join(tempDir, 'extensions')}`,
				`--user-data-dir=${userDataDir}`,
			];

			if (args.disable_site_isolation) {
				launchArgs.push('--disable-site-isolation-trials', '--disable-web-security');
			}

			if (withEvaluator) {
				const runnerPath = path.join(extensionPath, 'tests', 'e2e', 'runner', 'dist');
				const runnerIndex = path.join(runnerPath, 'index.js');
				if (!existsSync(runnerIndex)) {
					try {
						execSync('pnpm run build:e2e-runner', { cwd: extensionPath, stdio: 'pipe' });
					} catch (e) {
						// Runner not available — continue without evaluator
						sessionConfig.withEvaluator = false;
					}
				}
				if (sessionConfig.withEvaluator) {
					launchArgs.push(`--extensionTestsPath=${runnerPath}`);
				}
			}
			launchArgs.push(workspace);

			const display = ensureDisplay(args.screen_resolution);

			electronApp = await _electron.launch({
				executablePath: vscodePath,
				args: launchArgs,
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: undefined,
					...(display ? { DISPLAY: display } : {}),
				},
			});

			// Detect crash
			electronApp.on('close', () => {
				if (state === 'ready') {
					state = 'idle';
					electronApp = null;
					page = null;
					evaluateFn = null;
				}
			});

			page = await electronApp.firstWindow();

			// Capture console messages and errors from all frames (including webviews)
			consoleBuffer = [];
			page.on('console', msg => {
				consoleBuffer.push({
					type: msg.type(),
					text: msg.text(),
					url: msg.location()?.url ?? '',
					timestamp: Date.now(),
				});
				if (consoleBuffer.length > MAX_CONSOLE_ENTRIES) {
					consoleBuffer = consoleBuffer.slice(-MAX_CONSOLE_ENTRIES);
				}
			});
			page.on('pageerror', error => {
				consoleBuffer.push({
					type: 'error',
					text: `${error.name}: ${error.message}`,
					url: '',
					timestamp: Date.now(),
				});
				if (consoleBuffer.length > MAX_CONSOLE_ENTRIES) {
					consoleBuffer = consoleBuffer.slice(-MAX_CONSOLE_ENTRIES);
				}
			});

			// Connect evaluator
			if (sessionConfig.withEvaluator) {
				try {
					const evaluator = await connectEvaluator(electronApp);
					evaluateFn = evaluator.evaluate.bind(evaluator);
				} catch (e) {
					// Evaluator failed — continue without it
					evaluateFn = null;
					sessionConfig.withEvaluator = false;
				}
			}

			// Wait for extension activation
			await page.waitForTimeout(activationWait);

			state = 'ready';
			launchTime = Date.now();

			const parts = [`VS Code launched (${vscodePath}).`];
			parts.push(`Workspace: ${workspace}`);
			parts.push(`Extension: ${extensionPath}`);
			if (evaluateFn) parts.push('Evaluator bridge: connected');
			else
				parts.push('Evaluator bridge: not available (use with_evaluator: true and ensure E2E runner is built)');

			return textResult(parts.join('\n'));
		} catch (e) {
			await cleanup();
			return errorResult(`Launch failed: ${e.message}`);
		}
	},
);

// --- teardown ----------------------------------------------------------------
server.tool('teardown', 'Close the VS Code instance and clean up.', async () => {
	if (state === 'idle') {
		return textResult('No VS Code instance running.');
	}
	await cleanup();
	return textResult('VS Code closed and temp files cleaned up.');
});

// --- get_status --------------------------------------------------------------
server.tool('get_status', 'Get the current session state.', async () => {
	if (state === 'idle') {
		return textResult(JSON.stringify({ state: 'idle', running: false }, null, 2));
	}
	const info = {
		state,
		running: state === 'ready',
		uptime_ms: launchTime ? Date.now() - launchTime : 0,
		extension_path: sessionConfig.extensionPath,
		extension_id: sessionConfig.extensionId ?? '(not set)',
		evaluator: !!evaluateFn,
	};
	return textResult(JSON.stringify(info, null, 2));
});

// --- screenshot --------------------------------------------------------------
server.tool(
	'screenshot',
	`Capture a screenshot of the VS Code window or a specific webview. Returns an inline image. Images are automatically capped at ${MAX_SCREENSHOT_DIMENSION}px to stay within Claude's multi-image dimension limit.`,
	{
		target: z.enum(['full', 'webview']).optional().describe('What to capture (default: full)'),
		webview_title: z.string().optional().describe('Title of the webview to capture (for target: webview)'),
		scale: z
			.enum(['css', 'device'])
			.optional()
			.describe('Screenshot scale — "device" for full DPI, "css" for CSS pixels (default: device)'),
	},
	async args => {
		requireReady();
		const screenshotOpts = { fullPage: true };
		if (args.scale) screenshotOpts.scale = args.scale;
		try {
			if (args.target === 'webview' && args.webview_title) {
				// Try to find and screenshot just the webview
				const result = await findWebviewFrameLocator(args.webview_title, sessionConfig.extensionId);
				if (result) {
					// Screenshot the outer frame's element (contains the full webview)
					try {
						const frameElement = await result.outerFrame.frameElement();
						const opts = {};
						if (args.scale) opts.scale = args.scale;
						const buffer = await frameElement.screenshot(opts);
						return await imageResult(buffer);
					} catch {
						// Fall back to full page screenshot
					}
				}
			}
			try {
				const buffer = await page.screenshot(screenshotOpts);
				return await imageResult(buffer);
			} catch (screenshotErr) {
				// Page may be stale after a reload — try re-acquiring
				if (electronApp) {
					try {
						const windows = electronApp.windows();
						if (windows.length > 0) {
							page = windows[0];
							const buffer = await page.screenshot({ fullPage: true });
							return await imageResult(buffer);
						}
					} catch {}
					// Try firstWindow as last resort
					try {
						page = await electronApp.firstWindow();
						const buffer = await page.screenshot({ fullPage: true });
						return await imageResult(buffer);
					} catch {}
				}
				throw new Error(`Screenshot failed after recovery attempts: ${screenshotErr.message}`);
			}
		} catch (e) {
			return errorResult(`Screenshot failed: ${e.message}`);
		}
	},
);

// --- execute_command ---------------------------------------------------------
server.tool(
	'execute_command',
	'Execute a VS Code command by ID (e.g. "gitlens.showGraphView", "workbench.action.openSettings").',
	{
		command: z.string().describe('VS Code command ID'),
		args: z.array(z.unknown()).optional().describe('Command arguments'),
		wait_ms: z.number().optional().describe('Milliseconds to wait after execution (default: 1000)'),
	},
	async ({ command, args: cmdArgs, wait_ms }) => {
		requireReady();
		try {
			const waitTime = wait_ms ?? 1000;
			if (evaluateFn) {
				const result = await evaluateFn(
					(vscode, cmd, ...a) => vscode.commands.executeCommand(cmd, ...a),
					command,
					...(cmdArgs ?? []),
				);
				await page.waitForTimeout(waitTime);
				return textResult(
					`Command "${command}" executed.${result !== undefined ? ` Result: ${JSON.stringify(result)}` : ''}`,
				);
			} else {
				// Fallback: command palette
				const mod = process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P';
				await page.keyboard.press(mod);
				await page.waitForTimeout(400);
				await page.keyboard.type(command, { delay: 20 });
				await page.waitForTimeout(800);
				await page.keyboard.press('Enter');
				await page.waitForTimeout(waitTime);
				return textResult(`Command "${command}" executed via command palette.`);
			}
		} catch (e) {
			return errorResult(`Command failed: ${e.message}`);
		}
	},
);

// --- click -------------------------------------------------------------------
server.tool(
	'click',
	'Click an element by CSS selector. Can search within webview iframes.',
	{
		selector: z.string().describe('CSS selector for the element to click'),
		in_webview: z
			.boolean()
			.optional()
			.describe('Search within webview iframes (default: false). Implied by webview_title.'),
		webview_title: z.string().optional().describe('Specific webview to search in (implies in_webview)'),
	},
	async args => {
		requireReady();
		try {
			if (args.in_webview || args.webview_title) {
				if (args.webview_title) {
					const result = await findWebviewFrameLocator(args.webview_title, sessionConfig.extensionId);
					if (result) {
						await result.frameLocator.locator(args.selector).first().click({ timeout: 3000 });
						return textResult(`Clicked "${args.selector}" in webview "${args.webview_title}".`);
					}
				}
				// Search all frames
				const results = await queryAllFrames(page, args.selector, 'click');
				if (results.length === 0)
					return errorResult(`No element matching "${args.selector}" found in any frame.`);
				return textResult(`Clicked "${args.selector}" (in ${results[0].frame}).`);
			}
			await page.locator(args.selector).first().click({ timeout: 3000 });
			return textResult(`Clicked "${args.selector}".`);
		} catch (e) {
			return errorResult(`Click failed: ${e.message}`);
		}
	},
);

// --- type_text ---------------------------------------------------------------
server.tool(
	'type_text',
	'Type text into an input element or the currently focused element.',
	{
		text: z.string().describe('Text to type'),
		selector: z.string().optional().describe('CSS selector to focus before typing'),
		in_webview: z.boolean().optional().describe('Search within webview iframes'),
		press_enter: z.boolean().optional().describe('Press Enter after typing (default: false)'),
	},
	async args => {
		requireReady();
		try {
			if (args.selector) {
				if (args.in_webview) {
					const results = await queryAllFrames(page, args.selector, 'click');
					if (results.length === 0)
						return errorResult(`No element matching "${args.selector}" found in any frame.`);
				} else {
					await page.locator(args.selector).first().click({ timeout: 3000 });
				}
			}
			await page.keyboard.type(args.text, { delay: 20 });
			if (args.press_enter) {
				await page.keyboard.press('Enter');
			}
			return textResult(`Typed "${args.text}"${args.press_enter ? ' + Enter' : ''}.`);
		} catch (e) {
			return errorResult(`Type failed: ${e.message}`);
		}
	},
);

// --- press_key ---------------------------------------------------------------
server.tool(
	'press_key',
	'Press a keyboard shortcut (e.g. "Control+Shift+P", "Escape", "Enter", "F5").',
	{
		key: z.string().describe('Key combination to press'),
	},
	async args => {
		requireReady();
		try {
			await page.keyboard.press(args.key);
			return textResult(`Pressed "${args.key}".`);
		} catch (e) {
			return errorResult(`Key press failed: ${e.message}`);
		}
	},
);

// --- inspect_dom -------------------------------------------------------------
server.tool(
	'inspect_dom',
	'Query DOM elements by CSS selector. Returns text content, HTML, or attributes.',
	{
		selector: z.string().describe('CSS selector to query'),
		in_webview: z.boolean().optional().describe('Search within webview iframes (default: false)'),
		webview_title: z.string().optional().describe('Specific webview to search in'),
		property: z
			.enum(['textContent', 'innerHTML', 'outerHTML', 'attributes', 'shadowDOM'])
			.optional()
			.describe(
				'What to return (default: textContent). "shadowDOM" recursively serializes shadow roots for Lit/web components.',
			),
		max_results: z.number().optional().describe('Maximum number of results (default: 10)'),
	},
	async args => {
		requireReady();
		const prop = args.property ?? 'textContent';
		const maxResults = args.max_results ?? 10;

		try {
			if (args.in_webview || args.webview_title) {
				// Search in webview frames
				if (args.webview_title) {
					const result = await findWebviewFrameLocator(args.webview_title, sessionConfig.extensionId);
					if (result) {
						const results = await extractFromLocator(
							result.frameLocator.locator(args.selector),
							prop,
							maxResults,
						);
						return textResult(
							results.length > 0
								? results.map((r, i) => `[${i}] ${r}`).join('\n')
								: `No elements matching "${args.selector}" in webview "${args.webview_title}".`,
						);
					}
					return errorResult(`Webview "${args.webview_title}" not found.`);
				}
				// Search all frames
				const webviews = getWebviewFrameLocators(page);
				const allResults = [];
				let foundCount = 0;

				for (const { frameLocator, outerFrame, url } of webviews) {
					if (foundCount >= maxResults) break;
					try {
						const title = await outerFrame.title().catch(() => url.substring(0, 80));
						const extracted = await extractFromLocator(
							frameLocator.locator(args.selector),
							prop,
							maxResults - foundCount,
						);
						for (const text of extracted) {
							allResults.push(`--- ${title} ---\n${text}`);
							foundCount++;
						}
					} catch {}
				}

				if (allResults.length === 0)
					return textResult(`No elements matching "${args.selector}" in any webview frame.`);
				return textResult(allResults.map((r, i) => `[${i}] ${r}`).join('\n\n'));
			}

			const results = await extractFromLocator(page.locator(args.selector), prop, maxResults);
			return textResult(
				results.length > 0
					? results.map((r, i) => `[${i}] ${r}`).join('\n')
					: `No elements matching "${args.selector}".`,
			);
		} catch (e) {
			return errorResult(`Inspect failed: ${e.message}`);
		}
	},
);

async function extractFromLocator(locator, prop, maxResults) {
	const count = Math.min(await locator.count(), maxResults);
	const results = [];
	for (let i = 0; i < count; i++) {
		try {
			const el = locator.nth(i);
			let value;
			switch (prop) {
				case 'textContent':
					value = await el.textContent({ timeout: 1000 }).catch(() => null);
					if (value) value = value.trim();
					break;
				case 'innerHTML':
					value = await el.evaluate(e => e.innerHTML, null, { timeout: 1000 }).catch(() => null);
					break;
				case 'outerHTML':
					value = await el.evaluate(e => e.outerHTML, null, { timeout: 1000 }).catch(() => null);
					break;
				case 'attributes':
					value = await el
						.evaluate(
							e => JSON.stringify(Object.fromEntries([...e.attributes].map(a => [a.name, a.value]))),
							null,
							{ timeout: 1000 },
						)
						.catch(() => null);
					break;
				case 'shadowDOM':
					value = await el
						.evaluate(
							e => {
								function serialize(node, depth, maxDepth) {
									if (depth > maxDepth) return '  '.repeat(depth) + '...\n';
									const indent = '  '.repeat(depth);
									let out = '';
									if (node.nodeType === 3) {
										const t = node.textContent.trim();
										if (t) out += indent + t.substring(0, 200) + '\n';
										return out;
									}
									if (node.nodeType !== 1) return '';
									const tag = node.tagName.toLowerCase();
									const attrs = [...node.attributes]
										.filter(a => a.name !== 'class' || a.value.length < 100)
										.map(a => `${a.name}="${a.value}"`)
										.join(' ');
									const attrStr = attrs ? ' ' + attrs : '';
									const children = [];
									if (node.shadowRoot) {
										children.push(
											...Array.from(node.shadowRoot.childNodes).map(c =>
												serialize(c, depth + 1, maxDepth),
											),
										);
									}
									children.push(
										...Array.from(node.childNodes).map(c => serialize(c, depth + 1, maxDepth)),
									);
									const content = children.join('');
									if (!content.trim()) {
										return `${indent}<${tag}${attrStr} />\n`;
									}
									return `${indent}<${tag}${attrStr}>\n${content}${indent}</${tag}>\n`;
								}
								return serialize(e, 0, 10);
							},
							null,
							{ timeout: 5000 },
						)
						.catch(() => null);
					break;
			}
			if (value) results.push(value);
		} catch {}
	}
	return results;
}

// --- aria_snapshot -----------------------------------------------------------
server.tool(
	'aria_snapshot',
	'Get the accessibility tree as YAML. Useful for understanding the UI structure without screenshots. Supports webview iframes.',
	{
		selector: z.string().optional().describe('CSS selector for subtree (default: body)'),
		in_webview: z.boolean().optional().describe('Capture snapshot inside webview iframes (default: false)'),
		webview_title: z.string().optional().describe('Specific webview to capture snapshot from'),
	},
	async args => {
		requireReady();
		const sel = args.selector ?? 'body';
		try {
			if (args.webview_title) {
				const result = await findWebviewFrameLocator(args.webview_title, sessionConfig.extensionId);
				if (!result) return errorResult(`Webview "${args.webview_title}" not found.`);
				const snapshot = await result.frameLocator.locator(sel).first().ariaSnapshot({ timeout: 5000 });
				return textResult(snapshot);
			}
			if (args.in_webview) {
				const webviews = getWebviewFrameLocators(page);
				if (webviews.length === 0) return textResult('No webviews found.');
				const parts = [];
				for (const { frameLocator, outerFrame, url } of webviews) {
					try {
						const title = await outerFrame.title().catch(() => url.substring(0, 80));
						const snapshot = await frameLocator.locator(sel).first().ariaSnapshot({ timeout: 5000 });
						parts.push(`--- ${title} ---\n${snapshot}`);
					} catch {
						// Skip webviews that fail (may be loading or empty)
					}
				}
				return textResult(parts.length > 0 ? parts.join('\n\n') : 'No webview content found.');
			}
			const snapshot = await page.locator(sel).first().ariaSnapshot({ timeout: 5000 });
			return textResult(snapshot);
		} catch (e) {
			return errorResult(`Aria snapshot failed: ${e.message}`);
		}
	},
);

// --- list_webviews -----------------------------------------------------------
server.tool(
	'list_webviews',
	'List all open webviews with their titles, URLs, dimensions, and content status. Useful for discovering webview titles before using other webview-targeting tools.',
	{},
	async () => {
		requireReady();
		try {
			const webviews = getWebviewFrameLocators(page);
			if (webviews.length === 0) return textResult('No webviews found.');

			const results = [];
			for (const { frameLocator, outerFrame, url } of webviews) {
				const entry = { url: url.substring(0, 120) };
				try {
					entry.title = await outerFrame.title().catch(() => '(unknown)');
				} catch {
					entry.title = '(unknown)';
				}
				// Parse extensionId from URL query params
				try {
					const u = new URL(url);
					entry.extensionId = u.searchParams.get('extensionId') ?? undefined;
				} catch {}
				// Get dimensions
				try {
					const el = await outerFrame.frameElement();
					const box = await el.boundingBox();
					if (box)
						entry.dimensions = {
							width: Math.round(box.width),
							height: Math.round(box.height),
							x: Math.round(box.x),
							y: Math.round(box.y),
						};
				} catch {}
				// Check if content is loaded
				try {
					const text = await frameLocator
						.locator('body')
						.textContent({ timeout: 500 })
						.catch(() => '');
					entry.hasContent = !!(text && text.trim().length > 0);
				} catch {
					entry.hasContent = false;
				}
				results.push(entry);
			}
			return textResult(JSON.stringify(results, null, 2));
		} catch (e) {
			return errorResult(`List webviews failed: ${e.message}`);
		}
	},
);

// --- evaluate ----------------------------------------------------------------
server.tool(
	'evaluate',
	'Run a JavaScript expression in the VS Code extension host (Node.js) with the vscode API in scope. No DOM access — use evaluate_in_webview for webview DOM. Requires the evaluator bridge (with_evaluator: true on launch).',
	{
		expression: z.string().describe('JS expression to evaluate (e.g. "vscode.env.machineId")'),
	},
	async args => {
		requireReady();
		if (!evaluateFn) {
			return errorResult(
				'Evaluator bridge not connected. Relaunch with with_evaluator: true and ensure the E2E runner is built.',
			);
		}
		try {
			const fn = new Function('vscode', `return (${args.expression})`);
			const result = await evaluateFn(fn);
			return textResult(`Result: ${JSON.stringify(result, null, 2)}`);
		} catch (e) {
			return errorResult(`Evaluate failed: ${e.message}`);
		}
	},
);

// --- evaluate_in_webview -----------------------------------------------------
server.tool(
	'evaluate_in_webview',
	'Run JavaScript in the webview renderer context (browser/DOM). Access document, shadow DOM, Lit component state, computed styles, scroll positions. Does NOT have vscode API — use "evaluate" for that.',
	{
		expression: z
			.string()
			.describe(
				'JS expression to evaluate in the webview (e.g. "document.title", "document.querySelector(\'gl-home-app\').shadowRoot.innerHTML")',
			),
		webview_title: z.string().optional().describe('Webview to evaluate in (default: first found)'),
	},
	async args => {
		requireReady();
		try {
			const result = await findWebviewFrameLocator(args.webview_title, sessionConfig.extensionId);
			if (!result) {
				return errorResult(
					args.webview_title
						? `Webview "${args.webview_title}" not found. Use "list_webviews" to see available webviews.`
						: 'No webviews found. Open a webview first.',
				);
			}
			const value = await result.frameLocator.locator('body').evaluate(
				(body, expr) => {
					const fn = new Function(`return (${expr})`); // eslint-disable-line no-new-func -- intentional: inspector tool for local dev
					return fn();
				},
				args.expression,
				{ timeout: 5000 },
			);
			return textResult(`Result: ${JSON.stringify(value, null, 2)}`);
		} catch (e) {
			return errorResult(`Evaluate in webview failed: ${e.message}`);
		}
	},
);

// --- wait_for_webview --------------------------------------------------------
server.tool(
	'wait_for_webview',
	'Wait for a webview to be loaded and rendered. Checks for the removal of the "preload" CSS class (Lit hydration signal) or non-empty body content as fallback.',
	{
		webview_title: z.string().optional().describe('Title of the webview to wait for (default: any webview)'),
		selector: z.string().optional().describe('CSS selector to wait for inside the webview'),
		timeout_ms: z.number().optional().describe('Maximum wait time in ms (default: 10000)'),
	},
	async args => {
		requireReady();
		const timeout = args.timeout_ms ?? 10000;
		const startTime = Date.now();

		while (Date.now() - startTime < timeout) {
			const result = await findWebviewFrameLocator(args.webview_title, sessionConfig.extensionId);
			if (result) {
				try {
					if (args.selector) {
						// Wait for a specific selector to be present
						const count = await result.frameLocator
							.locator(args.selector)
							.count()
							.catch(() => 0);
						if (count > 0) {
							return textResult(
								`Webview ready (${Date.now() - startTime}ms). Selector "${args.selector}" found.`,
							);
						}
					} else {
						// Check for preload class removal (Lit hydration complete signal)
						const isReady = await result.frameLocator
							.locator('body')
							.evaluate(
								body => !body.classList.contains('preload') && body.textContent.trim().length > 0,
								null,
								{ timeout: 1000 },
							)
							.catch(() => false);
						if (isReady) {
							return textResult(`Webview ready (${Date.now() - startTime}ms).`);
						}
					}
				} catch {
					// Not ready yet
				}
			}
			await page.waitForTimeout(500);
		}

		return errorResult(
			`Webview not ready after ${timeout}ms.${args.webview_title ? ` Title: "${args.webview_title}".` : ''} Use "list_webviews" to check available webviews.`,
		);
	},
);

// --- read_logs ---------------------------------------------------------------
server.tool(
	'read_logs',
	'Search VS Code extension output logs for a pattern.',
	{
		pattern: z.string().optional().describe('Text pattern to search for (default: "GitLens")'),
		last_n: z.number().optional().describe('Only return the last N matching lines'),
	},
	async args => {
		requireReady();
		if (!userDataDir) return errorResult('No user data directory available.');
		try {
			const pattern = args.pattern ?? 'GitLens';
			let logs = await findLogs(userDataDir, pattern);
			if (args.last_n && args.last_n > 0) {
				logs = logs.slice(-args.last_n);
			}
			if (logs.length === 0) return textResult(`No log lines matching "${pattern}".`);
			return textResult(`Found ${logs.length} matching lines:\n${logs.map(l => l.substring(0, 500)).join('\n')}`);
		} catch (e) {
			return errorResult(`Log search failed: ${e.message}`);
		}
	},
);

// --- read_console ------------------------------------------------------------
server.tool(
	'read_console',
	'Read browser console messages (log, warn, error) from the VS Code main process. Cross-origin webview messages may not be captured — use evaluate_in_webview to inspect webview state directly.',
	{
		level: z
			.enum(['all', 'error', 'warning', 'log', 'info', 'debug'])
			.optional()
			.describe('Filter by log level (default: all)'),
		pattern: z.string().optional().describe('Filter messages containing this text'),
		last_n: z.number().optional().describe('Only return the last N messages'),
		clear: z.boolean().optional().describe('Clear the buffer after reading (default: false)'),
	},
	async args => {
		requireReady();
		let entries = [...consoleBuffer];

		// Filter by level
		if (args.level && args.level !== 'all') {
			entries = entries.filter(e => e.type === args.level);
		}
		// Filter by pattern
		if (args.pattern) {
			const pat = args.pattern.toLowerCase();
			entries = entries.filter(e => e.text.toLowerCase().includes(pat));
		}
		// Limit to last N
		if (args.last_n && args.last_n > 0) {
			entries = entries.slice(-args.last_n);
		}
		// Clear if requested
		if (args.clear) {
			consoleBuffer = [];
		}

		if (entries.length === 0) return textResult('No matching console messages.');
		const lines = entries.map(e => {
			const time = new Date(e.timestamp).toISOString().substring(11, 23);
			const src = e.url ? ` (${e.url.substring(0, 80)})` : '';
			return `[${time}] [${e.type}] ${e.text.substring(0, 500)}${src}`;
		});
		return textResult(`${entries.length} messages:\n${lines.join('\n')}`);
	},
);

// --- resize_viewport ---------------------------------------------------------
server.tool(
	'resize_viewport',
	'Resize the VS Code window viewport. Useful for testing responsive layouts or getting larger screenshots.',
	{
		width: z.number().describe('Viewport width in pixels'),
		height: z.number().describe('Viewport height in pixels'),
	},
	async args => {
		requireReady();
		try {
			await page.setViewportSize({ width: args.width, height: args.height });
			return textResult(`Viewport resized to ${args.width}x${args.height}.`);
		} catch (e) {
			return errorResult(`Resize failed: ${e.message}`);
		}
	},
);

// --- rebuild_and_reload ------------------------------------------------------
server.tool(
	'rebuild_and_reload',
	'Run the build command, then restart the extension host. Reconnects the evaluator bridge. For webview-only changes, build webviews and use the view refresh command (e.g. gitlens.views.home.refresh) instead of restarting the extension host.',
	{
		build_command: z
			.string()
			.optional()
			.describe('Build command to run (default: from .vscode-agent.json or "pnpm run build")'),
	},
	async args => {
		requireReady();
		const extensionPath = sessionConfig.extensionPath;
		const agentConfig = loadAgentConfig(extensionPath);
		const buildCommand = args.build_command ?? agentConfig.buildCommand ?? 'pnpm run build';

		try {
			// Run build
			const startTime = Date.now();
			try {
				execSync(buildCommand, {
					cwd: extensionPath,
					encoding: 'utf8',
					stdio: ['pipe', 'pipe', 'pipe'],
					timeout: 120000, // 2 minute timeout
				});
			} catch (e) {
				const stderr = e.stderr?.toString() ?? '';
				const stdout = e.stdout?.toString() ?? '';
				return errorResult(`Build failed (exit code ${e.status}):\n${stderr || stdout}`.substring(0, 2000));
			}
			const buildTime = ((Date.now() - startTime) / 1000).toFixed(1);

			// Restart the extension host (not a full window reload).
			// This keeps the Playwright page reference alive while reloading
			// all extensions with the newly-built code. Extension host code
			// changes take effect immediately. For webview-only changes,
			// use the view's refresh command instead (e.g. gitlens.views.home.refresh).
			if (evaluateFn) {
				try {
					await evaluateFn(vscode =>
						vscode.commands.executeCommand('workbench.extensions.action.restartExtensionHost'),
					);
				} catch {
					// Expected — restart kills the extension host, breaking the HTTP connection
				}
			} else {
				const mod = process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P';
				await page.keyboard.press(mod);
				await page.waitForTimeout(400);
				await page.keyboard.type('Developer: Restart Extension Host', { delay: 20 });
				await page.waitForTimeout(800);
				await page.keyboard.press('Enter');
			}

			// Wait for extension host to restart
			await new Promise(r => setTimeout(r, 3000));

			// Wait for extension to re-activate
			const agentCfg = loadAgentConfig(extensionPath);
			const activationWait = agentCfg.activationWait ?? 5000;
			await new Promise(r => setTimeout(r, activationWait));

			// Reconnect evaluator if it was active (skipCache to avoid stale URL from pre-restart)
			if (sessionConfig.withEvaluator) {
				try {
					const evaluator = await connectEvaluator(electronApp, { skipCache: true });
					evaluateFn = evaluator.evaluate.bind(evaluator);
				} catch {
					evaluateFn = null;
				}
			}

			const parts = [`Build succeeded (${buildTime}s). Extension host restarted.`];
			if (evaluateFn) parts.push('Evaluator: reconnected');
			else if (sessionConfig.withEvaluator)
				parts.push('Evaluator: reconnection failed (some tools may be limited)');

			return textResult(parts.join('\n'));
		} catch (e) {
			return errorResult(`Rebuild/reload failed: ${e.message}`);
		}
	},
);

// =============================================================================
// Start the MCP server
// =============================================================================
async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);

	// Clean up on exit
	process.on('SIGINT', async () => {
		await cleanup();
		process.exit(0);
	});
	process.on('SIGTERM', async () => {
		await cleanup();
		process.exit(0);
	});
}

main().catch(e => {
	console.error('MCP server error:', e);
	process.exit(1);
});
