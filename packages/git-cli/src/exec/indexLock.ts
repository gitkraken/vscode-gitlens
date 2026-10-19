import { setTimeout as wait } from 'timers/promises';
import { leadingCommand } from './commandClassifier.js';
import { CancelledRunError, RunError } from './exec.errors.js';
import { abortReason } from './gitQueue.js';

/**
 * Verbs that take `<gitdir>/index.lock` before changing anything, so a run that loses the race fails at once
 * with nothing half-done and is safe to retry. `stash` is left out because it is multi-step and can fail part
 * way, and the long or interactive verbs (`merge`, `rebase`, `cherry-pick`, `revert`, `am`, `pull`) because
 * holding the lock-ordering chain for their whole run would stall every other write to the checkout.
 */
const indexWritingVerbs: ReadonlySet<string> = new Set([
	'add',
	'checkout',
	'commit',
	'mv',
	'read-tree',
	'reset',
	'restore',
	'rm',
	'switch',
	'update-index',
]);

const applyIndexOptions: ReadonlySet<string> = new Set(['--index', '--cached', '--3way', '-3']);

/**
 * Matches git's `fatal: Unable to create '<path>/index.lock': File exists.` — the wording varies a little by version,
 * but git always `die()`s (`fatal:`) on it.
 * Anchored to the start of stderr: git takes the lock before doing anything else, so its own failure is the first
 * thing it prints past any `warning:`/`hint:` lines from parsing its arguments (`checkout` warns of an ambiguous
 * refname first). The same line after other output came from something the run started, such as a hook running its
 * own git command, after the run had already done its work — retrying would run it all again.
 */
const indexLockHeldRegex =
	/^(?:\s*(?:warning|hint): [^\r\n]*\r?\n)*\s*fatal: Unable to create '[^\r\n]*index\.lock': File exists/i;

/**
 * The exit code in a run error's `code`, or `undefined` when the process never exited normally: a numeric string
 * is a real exit code, but an errno (`'ENOENT'`) means the spawn itself failed, and `undefined` means it was killed.
 */
export function toExitCode(code: number | string | undefined): number | undefined {
	const exitCode = typeof code === 'number' ? code : code != null ? parseInt(code, 10) : NaN;
	return Number.isInteger(exitCode) ? exitCode : undefined;
}

/** Git's exit code when it `die()`s, as it does on a held `index.lock`. */
const gitFatalExitCode = 128;

/** How long to wait before each retry of a run that found `index.lock` held; its length is the retry count. */
export const indexLockRetryDelays: readonly number[] = [100, 200, 400];

/**
 * Whether the argv is a command that writes the index (`apply` only does with `--index`, `--cached` or `--3way`,
 * which implies `--index`, and never with `--check`).
 */
export function isIndexWriteCommand(args: readonly string[]): boolean {
	const { verb, rest } = leadingCommand(args);
	if (verb === 'apply') return !rest.includes('--check') && rest.some(a => applyIndexOptions.has(a));

	return indexWritingVerbs.has(verb);
}

/**
 * Whether a run failed because another process held `index.lock`. The exit code must be 128 too: a hook that
 * prints the same line from its own git command and fails makes the run exit 1, after the hook's work is done.
 */
export function isIndexLockHeldError(ex: unknown): boolean {
	return (
		ex instanceof RunError &&
		!(ex instanceof CancelledRunError) &&
		toExitCode(ex.code) === gitFatalExitCode &&
		indexLockHeldRegex.test(ex.stderr)
	);
}

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
async function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
	try {
		await wait(ms, undefined, { signal: signal });
	} catch (ex) {
		if (signal?.aborted) throw abortReason(signal);

		throw ex;
	}
}

/**
 * Captures the rest of git's `error: could not lock config file <path>[: <reason>]` line. A held lock reads
 * `: File exists`, except `--remove-section`/`--rename-section` print no reason (for any failure); permanent
 * failures (`Permission denied`, `No such file or directory`, ...) must not be retried.
 */
const configLockFailureRegex = /could not lock config file ([^\r\n]*)/i;

/**
 * Whether the argv is `git config`. Only that verb: others that write config (`branch -m`, `remote add`) can
 * fail after a partial change, so a blind retry isn't safe.
 */
export function isConfigCommand(args: readonly string[]): boolean {
	return leadingCommand(args).verb === 'config';
}

/** Whether a run failed because another process may hold the config file's `.lock`: the reason is `File exists` or absent. */
export function isConfigLockHeldError(ex: unknown): boolean {
	if (!(ex instanceof RunError) || ex instanceof CancelledRunError) return false;

	const rest = configLockFailureRegex.exec(ex.stderr)?.[1];
	if (rest == null) return false;

	return /: File exists\s*$/i.test(rest) || !rest.includes(': ');
}

/**
 * Runs `attempt`, and runs it again after each of {@link indexLockRetryDelays} while it fails with an error
 * `isHeldError` accepts. Any other failure, or the last lock failure, is rethrown as is.
 */
async function retryWhileHeld<T>(
	attempt: () => Promise<T>,
	signal: AbortSignal | undefined,
	isHeldError: (ex: unknown) => boolean,
	beforeRetry?: (lockError: Error) => void | Promise<void>,
): Promise<T> {
	for (let retry = 0; ; retry++) {
		let lockError: Error;
		try {
			return await attempt();
		} catch (ex) {
			if (retry >= indexLockRetryDelays.length || !isHeldError(ex)) throw ex;

			lockError = ex as Error;
		}

		await delay(indexLockRetryDelays[retry], signal);
		await beforeRetry?.(lockError);
	}
}

/**
 * Runs `attempt`, and runs it again after each of {@link indexLockRetryDelays} while it fails on a held
 * `index.lock`. Any other failure, or the last lock failure, is rethrown as is. `beforeRetry` runs after each
 * wait, right before the next attempt; whatever it throws ends the retrying and is rethrown.
 */
export function retryWhileIndexLocked<T>(
	attempt: () => Promise<T>,
	signal: AbortSignal | undefined,
	beforeRetry?: (lockError: Error) => void | Promise<void>,
): Promise<T> {
	return retryWhileHeld(attempt, signal, isIndexLockHeldError, beforeRetry);
}

/**
 * Like {@link retryWhileIndexLocked}, for a config write that loses the race for the file's `.lock` to another
 * process — git fails at once rather than waiting.
 */
export function retryWhileConfigLocked<T>(attempt: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	return retryWhileHeld(attempt, signal, isConfigLockHeldError);
}

/**
 * Runs the work for each key one at a time, in arrival order. A failing run doesn't hold up the next one, and a
 * run whose signal aborts while it waits rejects at once without ever starting.
 */
export class KeyedSequencer {
	/** The tail of each key's chain — settles once everything queued so far has finished or been dropped. */
	private readonly _tails = new Map<string, Promise<void>>();

	async run<T>(key: string, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
		const previous = this._tails.get(key);

		let release!: () => void;
		const tail = new Promise<void>(resolve => (release = resolve));
		this._tails.set(key, tail);

		const finish = () => {
			release();
			if (this._tails.get(key) === tail) {
				this._tails.delete(key);
			}
		};

		let started = false;
		try {
			if (previous != null) {
				await waitFor(previous, signal);
			}

			started = true;
			return await fn();
		} finally {
			if (started || previous == null) {
				finish();
			} else {
				// Dropped while waiting: whoever is queued behind still has to wait for the run ahead of us,
				// so the chain can only be released once that run is done.
				void previous.then(finish);
			}
		}
	}
}

function waitFor(promise: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
	if (signal == null) return promise;
	if (signal.aborted) return Promise.reject(abortReason(signal));

	return new Promise<void>((resolve, reject) => {
		const onAbort = () => reject(abortReason(signal));
		signal.addEventListener('abort', onAbort, { once: true });
		void promise.then(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		});
	});
}
