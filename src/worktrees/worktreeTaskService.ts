import type { Event, Task, TaskExecution } from 'vscode';
import { Disposable, EventEmitter, tasks } from 'vscode';

export interface RunningWorktreeTask {
	name: string;
}

/** Tracks tasks started from a worktree's Run Task button so the graph's WIP row can show a running
 *  indicator. One entry per worktree path — a new run for the same worktree replaces the previous entry. */
export class WorktreeTaskService implements Disposable {
	private readonly _running = new Map<string, { execution: TaskExecution; name: string }>();
	/** Worktrees with a launch in flight (task lookup, picker, `executeTask`) but nothing registered yet. */
	private readonly _launching = new Set<string>();
	private readonly _onDidChange = new EventEmitter<void>();
	private readonly _disposable: Disposable;

	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	constructor() {
		this._disposable = Disposable.from(
			this._onDidChange,
			tasks.onDidEndTask(e => {
				for (const [worktreePath, running] of this._running) {
					if (running.execution !== e.execution) continue;

					this._running.delete(worktreePath);
					this._onDidChange.fire();
					break;
				}
			}),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	/** Claims the launch slot for `worktreePath`; false when a launch or run is already underway there. */
	beginLaunch(worktreePath: string): boolean {
		if (this._launching.has(worktreePath)) return false;

		this._launching.add(worktreePath);
		return true;
	}

	endLaunch(worktreePath: string): void {
		this._launching.delete(worktreePath);
	}

	isRunning(worktreePath: string): boolean {
		return this._running.has(worktreePath);
	}

	async run(task: Task, worktreePath: string, name?: string): Promise<void> {
		const execution = await tasks.executeTask(task);
		this._running.set(worktreePath, { execution: execution, name: name ?? task.name });
		this._onDidChange.fire();
	}

	getRunning(): Record<string, RunningWorktreeTask> {
		const running: Record<string, RunningWorktreeTask> = {};
		for (const [worktreePath, task] of this._running) {
			running[worktreePath] = { name: task.name };
		}

		return running;
	}
}
