/**
 * Mocha root hooks for the integration suite: attribute an unhandled rejection to the test that was
 * running when it fired, print the git argv that produced it, and fail the run for it. It also fails the test whose
 * summary kept a base re-measure that a full read would not have answered (see `shadowCheck.ts`).
 *
 * These tests spawn real git against temp repos their own teardown deletes, so a git call a test
 * forgot to await (or cancel) fails LATER — after its repo is gone. Mocha does NOT fail anything for that on its
 * own: it forwards a rejection from user code back to `process` instead of failing the running test, and its CLI
 * overwrites `process.exitCode` with the failure count on exit. So this plugin records each unhandled rejection
 * (once, though mocha's re-emit calls the listener twice) and fails the run from a root hook: the `afterEach` of
 * the test running when it landed or of the next test, else the root `afterAll`. Under `--parallel` each worker
 * loads this plugin itself, and a hook failure is the only thing that reaches the main process (a worker's
 * `exitCode` never does). A rejection landing after the final root hook (after the last file a worker runs) can
 * still only be logged. Grep `[LEAK]` to find the real owner: the argv names the call site.
 */
import type { Context } from 'mocha';
import { takeBaseRemeasureMismatches } from './shadowCheck.js';

// A host app can inject git config through the environment (`core.hooksPath`, ...), which every spawned git
// would inherit and override the repos these tests set up
for (const name of Object.keys(process.env)) {
	if (
		name === 'GIT_CONFIG_COUNT' ||
		name === 'GIT_CONFIG_PARAMETERS' ||
		/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name)
	) {
		Reflect.deleteProperty(process.env, name);
	}
}

let running: string | undefined;
let previous: string | undefined;

function describeReason(reason: unknown): string {
	if (!(reason instanceof Error)) return String(reason);

	// `GitError` carries the spawn argv + exit code; that argv is what identifies the leaking caller.
	const { cmd, exitCode } = reason as Error & { cmd?: string; exitCode?: number | string };
	let out = reason.message.trim().replace(/\r?\n/g, ' · ');
	if (cmd != null) {
		out += `\n[LEAK]   cmd: ${cmd}`;
	}
	if (exitCode != null) {
		out += `\n[LEAK]   exit: ${exitCode}`;
	}
	if (reason.stack != null) {
		out += `\n${reason.stack}`;
	}
	return out;
}

const leaks: Error[] = [];
// Mocha re-emits a rejection it forwarded, so the same promise reaches the listener twice
const seen = new WeakSet<object>();

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
	if (seen.has(promise)) return;

	seen.add(promise);

	const where = running != null ? `while running "${running}"` : `between tests (after "${previous ?? '<none>'}")`;
	const message = `[LEAK] unhandled rejection ${where}: ${describeReason(reason)}`;
	console.error(message);
	leaks.push(new Error(message));
});

/** The leaks recorded since the last call, for a root hook to fail the run on */
function takeLeaks(): Error[] {
	return leaks.splice(0);
}

function describeLeaks(taken: Error[]): string {
	return `Unhandled rejections from git calls no test awaited (${taken.length}):\n${taken.map(l => l.message).join('\n---\n')}`;
}

/** The spawn argv a `GitError` carries, if the failure was a git call at all. */
function gitCommandOf(error: unknown): string | undefined {
	if (error == null || typeof error !== 'object' || !('cmd' in error)) return undefined;

	return typeof error.cmd === 'string' ? error.cmd : undefined;
}

export const mochaHooks = {
	beforeEach: function (this: Context): void {
		running = this.currentTest?.fullTitle();
	},
	afterEach: function (this: Context): void {
		previous = this.currentTest?.fullTitle() ?? running;
		running = undefined;

		// A failing git call reports only stderr; mocha never prints the argv that produced it. Without
		// this you can't tell WHICH git command failed, only that one did.
		const cmd = gitCommandOf(this.currentTest?.err);
		if (cmd != null) {
			console.error(`[LEAK] failing git command in "${previous}":\n[LEAK]   cmd: ${cmd}`);
		}

		// After the suite's own teardown, which disposes the services, so a read still running can't land later
		const mismatches = takeBaseRemeasureMismatches();
		const taken = takeLeaks();

		// Both reported together so neither hides the other
		const errors: string[] = [];
		if (mismatches.length) {
			errors.push(
				`The base re-measure answered differently from a full read of the base (${mismatches.length}):\n${mismatches.map(m => m.message).join('\n---\n')}`,
			);
		}

		if (taken.length) {
			errors.push(describeLeaks(taken));
		}

		if (errors.length) {
			throw new Error(errors.join('\n\n'));
		}
	},
	// Leaks that landed after the last test's afterEach: between tests or during suite teardown
	afterAll: function (): void {
		const taken = takeLeaks();
		if (taken.length) {
			throw new Error(describeLeaks(taken));
		}
	},
};
