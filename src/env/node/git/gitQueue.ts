import type { Disposable } from 'vscode';
import type { Container } from '../../../container.js';
import type { GitCommandPriority } from '../../../git/execTypes.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { Logger } from '../../../system/logger.js';

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

/**
 * Priority-based concurrent queue for git command execution.
 *
 * Implements a multi-level feedback queue with:
 * - Configurable max concurrent processes (read dynamically from settings)
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
export class GitQueue implements Disposable {
	private readonly _queues = new Map<GitCommandPriority, QueuedCommand[]>([
		['interactive', []],
		['normal', []],
		['background', []],
	]);

	private _activeCount = 0;
	private _disposed = false;

	constructor(private readonly _container: Container) {}

	dispose(): void {
		this._disposed = true;
		for (const queue of this._queues.values()) {
			for (const cmd of queue) {
				cmd.reject(new Error('GitQueue disposed'));
			}
			queue.length = 0;
		}
	}

	/** Get the configured max concurrent processes (read fresh for dynamic updates) */
	private get maxConcurrent(): number {
		return configuration.get('advanced.git.maxConcurrentProcesses') ?? 7;
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
		return new Promise<T>((resolve, reject) => {
			this._queues.get(priority)!.push({
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
			const stats = this.getStats();
			Logger.trace(`GitQueue: ${cmd.priority} command waited ${waitTime}ms`);
			this._container.telemetry.sendEvent('op/git/queueWait', {
				priority: cmd.priority,
				waitTime: waitTime,
				active: stats.active,
				'queued.interactive': stats.queued.interactive,
				'queued.normal': stats.queued.normal,
				'queued.background': stats.queued.background,
				maxConcurrent: stats.maxConcurrent,
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
