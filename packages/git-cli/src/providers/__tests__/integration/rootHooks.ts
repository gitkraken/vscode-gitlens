/**
 * Mocha root hooks for the integration suite: attribute an unhandled rejection to the test that was
 * running when it fired, and print the git argv that produced it.
 *
 * These tests spawn real git against temp repos their own teardown deletes, so a git call a test
 * forgot to await (or cancel) fails LATER — after its repo is gone — and mocha blames whichever test
 * happens to be running then, usually the longest one. Grep `[LEAK]` to find the real owner: the
 * argv names the call site.
 *
 * Only `unhandledRejection` is hooked. Mocha installs its own listener and fails the running test; this
 * one adds attribution. A rejection mocha CAN'T pin on a runnable it deliberately re-emits on `process`
 * for other listeners to handle — so this one owns that case and sets `exitCode`, because node's default
 * for it (a hard crash) is suppressed the moment any listener exists. Dropping that line would make the
 * suite silently tolerate rejections it used to die on.
 */
import type { Context } from 'mocha';

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

process.on('unhandledRejection', (reason: unknown) => {
	const where = running != null ? `while running "${running}"` : `between tests (after "${previous ?? '<none>'}")`;
	console.error(`[LEAK] unhandled rejection ${where}: ${describeReason(reason)}`);

	if (running == null) {
		process.exitCode = 1;
	}
});

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
	},
};
