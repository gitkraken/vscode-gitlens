import type { GitCommandPriority } from './exec.types.js';

interface QueuedCommand {
	run: () => Promise<unknown>;
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
	queuedAt: number;
	priority: GitCommandPriority;
	signal?: AbortSignal;
	abortHandler?: () => void;
}

/** Priority levels in descending order (highest first) */
const priorities: GitCommandPriority[] = ['interactive', 'normal', 'background'];

/** How many extra slots interactive commands can use when at capacity */
const interactiveBurstCapacity = 2;

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new Error('Aborted');
}

export interface GitQueueConfig {
	/** Maximum number of concurrent git processes. Defaults to 7. */
	maxConcurrent?: number;
	/** Maximum number of queued commands per priority level. Defaults to 500. Set to 0 to disable. */
	maxQueueDepth?: number;
}

export interface GitQueueHooks {
	/** Called when a queued command waited longer than 1 second before executing */
	onSlowQueue?(info: {
		priority: GitCommandPriority;
		waitTime: number;
		active: number;
		queued: Record<GitCommandPriority, number>;
		maxConcurrent: number;
	}): void;
}

/**
 * Priority-based concurrent queue for git command execution.
 *
 * Implements a multi-level feedback queue with:
 * - Configurable max concurrent processes
 * - Strict priority ordering (interactive > normal > background)
 * - Burst capacity for interactive commands under pressure
 *
 * Capacity rules (with limit N, burst B=2):
 * - All priorities share N slots normally
 * - When at capacity, interactive can burst up to N+B total
 *
 * Scheduling rules:
 * - Higher priority preempts: if interactive is waiting, normal/background queue
 * - Lower priority yields: background won't run if normal is waiting
 */
export class GitQueue {
	private readonly _queues = new Map<GitCommandPriority, QueuedCommand[]>([
		['interactive', []],
		['normal', []],
		['background', []],
	]);

	private _activeCount = 0;
	private _disposed = false;

	constructor(
		private readonly _config: GitQueueConfig = {},
		private readonly _hooks: GitQueueHooks = {},
	) {}

	dispose(): void {
		this._disposed = true;
		for (const queue of this._queues.values()) {
			for (const cmd of queue) {
				if (cmd.signal != null && cmd.abortHandler != null) {
					cmd.signal.removeEventListener('abort', cmd.abortHandler);
				}
				cmd.reject(new Error('GitQueue disposed'));
			}
			queue.length = 0;
		}
	}

	/** Get the configured max concurrent processes */
	private get maxConcurrent(): number {
		return this._config.maxConcurrent ?? 7;
	}

	/** Update configuration (e.g., when user changes settings) */
	updateConfig(config: Partial<GitQueueConfig>): void {
		if (config.maxConcurrent != null && config.maxConcurrent > 0) {
			this._config.maxConcurrent = config.maxConcurrent;
		}
		if (config.maxQueueDepth != null && config.maxQueueDepth > 0) {
			this._config.maxQueueDepth = config.maxQueueDepth;
		}
	}

	/** Check if a command at the given priority can execute immediately */
	private canRunNow(priority: GitCommandPriority): boolean {
		// Must yield to higher priority waiting
		if (this.hasHigherPriorityWaiting(priority)) return false;

		const max = this.maxConcurrent;

		// Under normal limit - all priorities can run
		if (this._activeCount < max) return true;

		// At or over normal limit - only interactive can burst
		if (priority === 'interactive' && this._activeCount < max + interactiveBurstCapacity) {
			return true;
		}

		return false;
	}

	/** Check if any higher-priority commands are waiting */
	private hasHigherPriorityWaiting(priority: GitCommandPriority): boolean {
		for (const p of priorities) {
			if (p === priority) return false;
			if (this._queues.get(p)!.length > 0) return true;
		}
		return false;
	}

	/**
	 * Execute a git command with the specified priority.
	 *
	 * When `signal` is provided:
	 * - If already aborted, rejects immediately without running.
	 * - If aborted while queued, the command is removed from the queue and rejected before it ever runs.
	 * - If aborted while running, the in-flight spawn must honor the same signal separately
	 *   (callers pass it via `runOpts.cancellation`); the queue does not interrupt running work.
	 */
	run<T>(priority: GitCommandPriority, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		if (this._disposed) {
			return Promise.reject(new Error('GitQueue disposed'));
		}

		if (signal?.aborted) {
			return Promise.reject(abortReason(signal));
		}

		if (!this.canRunNow(priority)) {
			return this.enqueue(fn, priority, signal);
		}

		return this.runcore(fn);
	}

	private async runcore<T>(fn: () => Promise<T>): Promise<T> {
		this._activeCount++;
		try {
			return await fn();
		} finally {
			this._activeCount--;
			this.processQueues();
		}
	}

	private enqueue<T>(fn: () => Promise<T>, priority: GitCommandPriority, signal?: AbortSignal): Promise<T> {
		const queue = this._queues.get(priority)!;
		const maxDepth = this._config.maxQueueDepth ?? 500;
		if (maxDepth > 0 && queue.length >= maxDepth) {
			return Promise.reject(new Error(`GitQueue '${priority}' queue is full (${maxDepth} commands pending)`));
		}

		return new Promise<T>((resolve, reject) => {
			const cmd: QueuedCommand = {
				run: fn,
				resolve: resolve as (value: unknown) => void,
				reject: reject,
				queuedAt: Date.now(),
				priority: priority,
				signal: signal,
			};

			if (signal != null) {
				cmd.abortHandler = () => {
					const idx = queue.indexOf(cmd);
					// If still queued, remove and reject so it never runs.
					// If already dequeued, the running command should honor the signal at its own layer.
					if (idx !== -1) {
						queue.splice(idx, 1);
						cmd.reject(abortReason(signal));
					}
				};
				signal.addEventListener('abort', cmd.abortHandler, { once: true });
			}

			queue.push(cmd);
		});
	}

	private processQueues(): void {
		if (this._disposed) return;

		const max = this.maxConcurrent;

		for (const priority of priorities) {
			const queue = this._queues.get(priority)!;
			const limit = priority === 'interactive' ? max + interactiveBurstCapacity : max;

			while (queue.length > 0 && this._activeCount < limit && !this.hasHigherPriorityWaiting(priority)) {
				this.runQueued(queue.shift()!);
			}
		}
	}

	private runQueued(cmd: QueuedCommand): void {
		// Detach the abort listener now that the command has left the queue — any subsequent
		// abort must be handled by the running spawn itself (via runOpts.cancellation).
		if (cmd.signal != null && cmd.abortHandler != null) {
			cmd.signal.removeEventListener('abort', cmd.abortHandler);
			cmd.abortHandler = undefined;
		}

		const waitTime = Date.now() - cmd.queuedAt;
		if (waitTime > 1000) {
			this._hooks.onSlowQueue?.({
				priority: cmd.priority,
				waitTime: waitTime,
				active: this._activeCount,
				queued: {
					interactive: this._queues.get('interactive')!.length,
					normal: this._queues.get('normal')!.length,
					background: this._queues.get('background')!.length,
				},
				maxConcurrent: this.maxConcurrent,
			});
		}

		this._activeCount++;
		try {
			cmd.run()
				.then(cmd.resolve, cmd.reject)
				.finally(() => {
					this._activeCount--;
					this.processQueues();
				});
		} catch (ex) {
			this._activeCount--;
			cmd.reject(ex);
			this.processQueues();
		}
	}

	/** Returns current queue statistics for diagnostics */
	getStats(): { active: number; queued: Record<GitCommandPriority, number>; maxConcurrent: number } {
		return {
			active: this._activeCount,
			queued: {
				interactive: this._queues.get('interactive')!.length,
				normal: this._queues.get('normal')!.length,
				background: this._queues.get('background')!.length,
			},
			maxConcurrent: this.maxConcurrent,
		};
	}
}

/**
 * Git global options that consume the next positional arg as their value
 * (e.g. `--work-tree <path>`). Long-form `--name=value` is already skipped by
 * the leading-dash check, so only the separated form needs explicit handling.
 */
const optionsTakingValue = new Set([
	'-c',
	'-C',
	'--git-dir',
	'--work-tree',
	'--namespace',
	'--exec-path',
	'--super-prefix',
	'--config-env',
	'--attr-source',
	'--list-cmds',
]);

/**
 * Infers a queue priority from the git command being invoked.
 *
 * Intentionally narrow: only returns 'background' for commands that are
 * *always* read-only AND *always* potentially expensive. Polymorphic commands
 * like `log` and `rev-list` (which can be quick bounded lookups or full-history
 * walks) are deliberately omitted — call sites that perform heavy walks must
 * pass `priority: 'background'` explicitly. Never upgrades to 'interactive'.
 *
 * No subcommand awareness (e.g. `stash list`, `branch -l`): the risk of
 * misclassifying a write subcommand as background outweighs the gain.
 */
export function inferGitCommandPriority(args: readonly (string | undefined)[]): GitCommandPriority {
	let command: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a == null) continue;
		if (optionsTakingValue.has(a)) {
			const next = args[i + 1];
			if (next != null && !next.startsWith('-')) {
				i++;
			}
			continue;
		}
		if (a.startsWith('-')) continue;

		command = a;
		break;
	}

	switch (command) {
		case 'for-each-ref':
		case 'shortlog':
		case 'reflog':
		case 'name-rev':
		case 'describe':
		case 'cherry':
		case 'count-objects':
		case 'fsck':
			return 'background';
		default:
			return 'normal';
	}
}
