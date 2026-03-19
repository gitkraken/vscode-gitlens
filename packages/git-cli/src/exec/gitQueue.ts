import type { GitCommandPriority } from './exec.types.js';

interface QueuedCommand {
	execute: () => Promise<unknown>;
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
	queuedAt: number;
	priority: GitCommandPriority;
}

/** Priority levels in descending order (highest first) */
const priorities: GitCommandPriority[] = ['interactive', 'normal', 'background'];

/** How many extra slots interactive commands can use when at capacity */
const interactiveBurstCapacity = 2;

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
		if (config.maxConcurrent != null) {
			this._config.maxConcurrent = config.maxConcurrent;
		}
		if (config.maxQueueDepth != null) {
			this._config.maxQueueDepth = config.maxQueueDepth;
		}
	}

	/** Check if a command at the given priority can execute immediately */
	private canExecuteNow(priority: GitCommandPriority): boolean {
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

	/** Execute a git command with the specified priority */
	execute<T>(priority: GitCommandPriority, fn: () => Promise<T>): Promise<T> {
		if (this._disposed) {
			return Promise.reject(new Error('GitQueue disposed'));
		}

		if (!this.canExecuteNow(priority)) {
			return this.enqueue(fn, priority);
		}

		return this.run(fn);
	}

	private async run<T>(fn: () => Promise<T>): Promise<T> {
		this._activeCount++;
		try {
			return await fn();
		} finally {
			this._activeCount--;
			this.processQueues();
		}
	}

	private enqueue<T>(fn: () => Promise<T>, priority: GitCommandPriority): Promise<T> {
		const queue = this._queues.get(priority)!;
		const maxDepth = this._config.maxQueueDepth ?? 500;
		if (maxDepth > 0 && queue.length >= maxDepth) {
			return Promise.reject(new Error(`GitQueue '${priority}' queue is full (${maxDepth} commands pending)`));
		}

		return new Promise<T>((resolve, reject) => {
			queue.push({
				execute: fn as () => Promise<unknown>,
				resolve: resolve as (value: unknown) => void,
				reject: reject,
				queuedAt: Date.now(),
				priority: priority,
			});
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
			cmd.execute()
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
 * Infers priority from git command type.
 * Only downgrades to 'background' for expensive commands; never upgrades to 'interactive'.
 */
export function inferGitCommandPriority(args: readonly (string | undefined)[]): GitCommandPriority {
	const command = args.find(a => a != null && !a.startsWith('-'));

	switch (command) {
		case 'log':
		case 'rev-list':
		case 'for-each-ref':
		case 'shortlog':
		case 'reflog':
			return 'background';
		default:
			return 'normal';
	}
}
