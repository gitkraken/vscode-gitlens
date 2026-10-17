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

/** Matches git's `Unable to create '<path>/index.lock': File exists.` — the wording varies a little by version. */
const indexLockHeldRegex = /index\.lock': File exists/i;

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

/** Whether a run failed because another process held `index.lock`. */
export function isIndexLockHeldError(ex: unknown): boolean {
	return ex instanceof RunError && !(ex instanceof CancelledRunError) && indexLockHeldRegex.test(ex.stderr);
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
 * Runs `attempt`, and runs it again after each of {@link indexLockRetryDelays} while it fails on a held
 * `index.lock`. Any other failure, or the last lock failure, is rethrown as is.
 */
export async function retryWhileIndexLocked<T>(attempt: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	for (let retry = 0; ; retry++) {
		try {
			return await attempt();
		} catch (ex) {
			if (retry >= indexLockRetryDelays.length || !isIndexLockHeldError(ex)) throw ex;
		}

		await delay(indexLockRetryDelays[retry], signal);
	}
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
