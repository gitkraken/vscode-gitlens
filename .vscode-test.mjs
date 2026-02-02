import { execSync, spawn } from 'node:child_process';
import process from 'node:process';
import { defineConfig } from '@vscode/test-cli';

/** Xvfb display number used for headless Linux testing */
const XVFB_DISPLAY = ':99';

/**
 * Ensures Xvfb is running for headless Linux environments (WSL/SSH).
 * Mirrors the e2e test approach for consistent behavior across test types.
 * Returns the DISPLAY value to use, or undefined if not needed.
 */
function ensureXvfb() {
	// Only needed on Linux without a display
	if (process.platform !== 'linux' || process.env.DISPLAY) {
		return process.env.DISPLAY;
	}

	try {
		// Check if Xvfb is available
		execSync('which Xvfb', { stdio: 'ignore' });

		// Check if Xvfb is already running on our display
		try {
			execSync(`xdpyinfo -display ${XVFB_DISPLAY}`, { stdio: 'ignore' });
			// Already running
			return XVFB_DISPLAY;
		} catch {
			// Not running, start it
		}

		// Start Xvfb
		const xvfbProcess = spawn('Xvfb', [XVFB_DISPLAY, '-screen', '0', '1920x1080x24'], {
			detached: true,
			stdio: 'ignore',
		});
		xvfbProcess.unref();

		// Give Xvfb time to start
		execSync('sleep 0.5');

		console.log(`Started Xvfb on display ${XVFB_DISPLAY}`);
		return XVFB_DISPLAY;
	} catch {
		// Xvfb not available
		return undefined;
	}
}

// Ensure Xvfb is running before tests start
const display = ensureXvfb();

export default defineConfig([
	{
		label: 'Unit Tests',
		files: 'out/tests/**/*.test.js',
		version: 'stable',
		launchArgs: ['--disable-extensions', '--disable-gpu'],
		env: display ? { DISPLAY: display } : {},
		mocha: {
			ui: 'tdd',
			timeout: 20000,
			color: true,
		},
	},
]);
