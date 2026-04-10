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

function ensureDisplay() {
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
		xvfbProcess = spawn('Xvfb', [XVFB_DISPLAY, '-screen', '0', '1920x1080x24'], {
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

function imageResult(buffer) {
	return {
		content: [{ type: 'image', data: buffer.toString('base64'), mimeType: 'image/png' }],
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
		try {
			const title = await outerFrame.title().catch(() => '');
			if (title && title.toLowerCase().includes(webviewTitle.toLowerCase())) {
				return { frameLocator, outerFrame };
			}
		} catch {}
	}
	// Fallback: return first webview with non-empty content
	for (const entry of webviews) {
		try {
			const bodyText = await entry.frameLocator
				.locator('body')
				.textContent({ timeout: 500 })
				.catch(() => '');
			if (bodyText) return entry;
		} catch {}
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

			const display = ensureDisplay();

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
	'Capture a screenshot of the VS Code window or a specific webview. Returns an inline image.',
	{
		target: z.enum(['full', 'webview']).optional().describe('What to capture (default: full)'),
		webview_title: z.string().optional().describe('Title of the webview to capture (for target: webview)'),
	},
	async args => {
		requireReady();
		try {
			if (args.target === 'webview' && args.webview_title) {
				// Try to find and screenshot just the webview
				const result = await findWebviewFrameLocator(args.webview_title, sessionConfig.extensionId);
				if (result) {
					// Screenshot the outer frame's element (contains the full webview)
					try {
						const frameElement = await result.outerFrame.frameElement();
						const buffer = await frameElement.screenshot();
						return imageResult(buffer);
					} catch {
						// Fall back to full page screenshot
					}
				}
			}
			try {
				const buffer = await page.screenshot({ fullPage: true });
				return imageResult(buffer);
			} catch (screenshotErr) {
				// Page may be stale after a reload — try re-acquiring
				if (electronApp) {
					try {
						const windows = electronApp.windows();
						if (windows.length > 0) {
							page = windows[0];
							const buffer = await page.screenshot({ fullPage: true });
							return imageResult(buffer);
						}
					} catch {}
					// Try firstWindow as last resort
					try {
						page = await electronApp.firstWindow();
						const buffer = await page.screenshot({ fullPage: true });
						return imageResult(buffer);
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
		in_webview: z.boolean().optional().describe('Search within webview iframes (default: false)'),
		webview_title: z.string().optional().describe('Specific webview to search in'),
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
			.enum(['textContent', 'innerHTML', 'outerHTML', 'attributes'])
			.optional()
			.describe('What to return (default: textContent)'),
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
				const results = await queryAllFrames(page, args.selector);
				if (results.length === 0) return textResult(`No elements matching "${args.selector}" in any frame.`);
				return textResult(results.map((r, i) => `[${i}] "${r.text}" (in ${r.frame})`).join('\n'));
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
			}
			if (value) results.push(value);
		} catch {}
	}
	return results;
}

// --- aria_snapshot -----------------------------------------------------------
server.tool(
	'aria_snapshot',
	'Get the accessibility tree as YAML. Useful for understanding the UI structure without screenshots.',
	{
		selector: z.string().optional().describe('CSS selector for subtree (default: full window body)'),
	},
	async args => {
		requireReady();
		try {
			const sel = args.selector ?? 'body';
			const snapshot = await page.locator(sel).first().ariaSnapshot({ timeout: 5000 });
			return textResult(snapshot);
		} catch (e) {
			return errorResult(`Aria snapshot failed: ${e.message}`);
		}
	},
);

// --- evaluate ----------------------------------------------------------------
server.tool(
	'evaluate',
	'Run a JavaScript expression in the VS Code extension host with the vscode API in scope. Requires the evaluator bridge (with_evaluator: true on launch).',
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

			// Reconnect evaluator if it was active
			if (sessionConfig.withEvaluator) {
				try {
					const evaluator = await connectEvaluator(electronApp);
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
