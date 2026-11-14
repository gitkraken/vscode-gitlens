import { stat } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import type { BatchedStat } from '@gitlens/git/watching/unwatchedCacheValidator.js';
import { isNotFound } from '@gitlens/git/watching/watchGroup.js';

/**
 * Stats each path it's sent, synchronously, and answers them as one message: a thread making a batch's stats back to
 * back spends far less than the round trip each asynchronous stat makes to libuv's pool. Evaluated as a script, so the
 * package ships no file of its own for it. `throwIfNoEntry: false` answers `undefined` for a path that isn't there,
 * as Node also does for one under a file. Reads as {@link statLocal} does
 */
const statWorkerSource = `
const { statSync } = require('node:fs');
const { parentPort } = require('node:worker_threads');
parentPort.on('message', paths => {
	parentPort.postMessage(
		paths.map(path => {
			try {
				const stat = statSync(path, { throwIfNoEntry: false });
				return stat == null ? 'missing' : { mtime: stat.mtimeMs, size: stat.size };
			} catch (ex) {
				return ex != null && (ex.code === 'ENOENT' || ex.code === 'ENOTDIR') ? 'missing' : 'unreadable';
			}
		}),
	);
});
`;

/** How long a worker beyond the first stays idle before it's stopped */
const defaultIdleTimeoutMs = 30_000;
/** What `maxWorkers` reads as when it isn't a number, as `UnwatchedCacheValidatorOptions.maxFsThreads` does */
const defaultMaxWorkers = 2;
/** Workers at most, whatever `maxWorkers` asks for: a batch serves as well on the calling thread past it */
const maxPoolWorkers = 4;

/**
 * `path`'s modification time (ms since the epoch) and size, read from the local file system; `undefined` when it isn't
 * there, or is under a path that is a file. Rejects when the stat failed otherwise
 */
export async function statLocal(path: string): Promise<{ mtime: number; size: number } | undefined> {
	try {
		const s = await stat(path);
		return { mtime: s.mtimeMs, size: s.size };
	} catch (ex) {
		if (isNotFound(ex) || (ex as { code?: unknown } | undefined)?.code === 'ENOTDIR') return undefined;

		throw ex;
	}
}

interface PooledWorker {
	readonly worker: Worker;
	/** Whether it's running (its `online` event fired); only then is it handed a batch */
	online: boolean;
	/** What settles the batch in flight; `undefined` while idle */
	batch:
		| { readonly resolve: (readings: readonly BatchedStat[]) => void; readonly reject: (ex: Error) => void }
		| undefined;
	idleTimer: ReturnType<typeof setTimeout> | undefined;
}

export interface StatWorkerPoolOptions {
	/**
	 * Workers at most, each serving one batch at a time, hung and starting ones included; at most 4, and read as
	 * `UnwatchedCacheValidatorOptions.maxFsThreads` is (2 when it isn't a number, at least 1)
	 */
	readonly maxWorkers: number;
	/** How long a worker beyond the first stays idle before it's stopped. Default: 30 seconds */
	readonly idleTimeoutMs?: number;
}

/**
 * Worker threads that stat many paths as one call (see `UnwatchedCacheValidatorOptions.statMany`). A batch takes an
 * idle running worker. When none is free, the batch is served on the calling thread, one asynchronous stat at a time,
 * and, while fewer than `maxWorkers` run and none is starting, a worker is started in the background for the batches
 * after it, so no read waits for a worker to start. A worker whose batch never returns (a hung mount) stays busy and
 * is never handed another; one that fails or exits rejects its batch and leaves the pool, and one that does so without a
 * batch rejects the next one. A busy worker keeps the process alive, as a pending file-system call does; an idle or
 * starting one doesn't. One idle worker is kept; the others are stopped once idle for `idleTimeoutMs`.
 */
export class StatWorkerPool {
	private readonly workers = new Set<PooledWorker>();
	private readonly maxWorkers: number;
	private readonly idleTimeoutMs: number;
	/** Why the last worker to fail without a batch failed, until a batch is rejected with it */
	private idleFailure: Error | undefined;
	private disposed = false;

	constructor(options: StatWorkerPoolOptions) {
		const maxWorkers = Math.floor(options.maxWorkers);
		this.maxWorkers = Math.min(
			Number.isNaN(maxWorkers) ? defaultMaxWorkers : Math.max(1, maxWorkers),
			maxPoolWorkers,
		);
		this.idleTimeoutMs = options.idleTimeoutMs ?? defaultIdleTimeoutMs;
	}

	dispose(): void {
		this.disposed = true;
		for (const pooled of [...this.workers]) {
			this.drop(pooled, new Error('The stat worker pool was disposed'));
		}
	}

	/** One reading per path, in order; rejects when a worker failed the batch, or once disposed. Never throws */
	statMany(paths: readonly string[]): Promise<readonly BatchedStat[]> {
		if (this.disposed) return Promise.reject(new Error('The stat worker pool was disposed'));

		// Rejected rather than served on the calling thread, so a worker that can't run isn't started again for each batch
		if (this.idleFailure != null) {
			const failure = this.idleFailure;
			this.idleFailure = undefined;
			return Promise.reject(failure);
		}

		let pooled: PooledWorker | undefined;
		let starting = false;
		for (const candidate of this.workers) {
			if (!candidate.online) {
				starting = true;
			} else if (candidate.batch == null) {
				pooled = candidate;
				break;
			}
		}
		if (pooled == null) {
			if (!starting && this.workers.size < this.maxWorkers) {
				try {
					this.spawn();
				} catch (ex) {
					return Promise.reject(ex instanceof Error ? ex : new Error(String(ex)));
				}
			}
			return statOnCallingThread(paths);
		}

		const worker = pooled;
		return new Promise<readonly BatchedStat[]>((resolve, reject) => {
			if (worker.idleTimer != null) {
				clearTimeout(worker.idleTimer);
				worker.idleTimer = undefined;
			}
			// Claimed before anything is awaited, so a call meanwhile takes another worker
			worker.batch = { resolve: resolve, reject: reject };
			worker.worker.ref();
			try {
				worker.worker.postMessage(paths);
			} catch (ex) {
				this.drop(worker, ex instanceof Error ? ex : new Error(String(ex)));
			}
		});
	}

	/** Starts a worker that answers each batch of paths it's sent with one {@link BatchedStat} per path, in order */
	protected createWorker(): Worker {
		// No `execArgv` of the host's (a loader, an inspector), which only slows a worker down that needs none of it
		return new Worker(statWorkerSource, { eval: true, execArgv: [] });
	}

	private spawn(): void {
		const worker = this.createWorker();
		const pooled: PooledWorker = { worker: worker, online: false, batch: undefined, idleTimer: undefined };
		this.workers.add(pooled);
		worker.unref();

		worker.on('online', () => {
			if (!this.workers.has(pooled)) return;

			pooled.online = true;
			this.startIdleTimer(pooled);
		});
		worker.on('message', (readings: readonly BatchedStat[]) => {
			const batch = pooled.batch;
			if (batch == null) return;

			pooled.batch = undefined;
			worker.unref();
			this.startIdleTimer(pooled);
			batch.resolve(readings);
		});
		const fail = (reason: Error): void => {
			if (pooled.batch == null && this.workers.has(pooled)) {
				this.idleFailure = reason;
			}
			this.drop(pooled, reason);
		};
		worker.on('messageerror', fail);
		worker.on('error', fail);
		worker.on('exit', code => fail(new Error(`The stat worker exited with code ${code}`)));
	}

	/** Stops an idle worker once it stayed idle for {@link idleTimeoutMs}, unless it's the only idle one */
	private startIdleTimer(pooled: PooledWorker): void {
		const timer = setTimeout(() => {
			pooled.idleTimer = undefined;
			if (pooled.batch != null) return;

			let idle = 0;
			for (const candidate of this.workers) {
				if (candidate.online && candidate.batch == null) {
					idle++;
				}
			}
			if (idle > 1) {
				this.drop(pooled, new Error('The stat worker was idle'));
			}
		}, this.idleTimeoutMs);
		timer.unref();
		pooled.idleTimer = timer;
	}

	/** Takes `pooled` out of the pool and stops it, rejecting its batch in flight with `reason` */
	private drop(pooled: PooledWorker, reason: Error): void {
		if (!this.workers.delete(pooled)) return;

		if (pooled.idleTimer != null) {
			clearTimeout(pooled.idleTimer);
			pooled.idleTimer = undefined;
		}
		const batch = pooled.batch;
		pooled.batch = undefined;
		batch?.reject(reason);
		void pooled.worker.terminate().catch(() => {});
	}
}

/**
 * Reads each path with {@link statLocal}, one at a time, so the batch holds one of Node's file-system threads at a
 * time, as the gate it went through counts it
 */
async function statOnCallingThread(paths: readonly string[]): Promise<readonly BatchedStat[]> {
	const readings: BatchedStat[] = [];
	for (const path of paths) {
		try {
			readings.push((await statLocal(path)) ?? 'missing');
		} catch {
			readings.push('unreadable');
		}
	}
	return readings;
}
