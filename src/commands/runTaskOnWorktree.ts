import type {
	Disposable,
	ProcessExecutionOptions,
	QuickInputButton,
	QuickPickItem,
	ShellExecutionOptions,
	Task,
} from 'vscode';
import {
	ProcessExecution,
	QuickPickItemKind,
	ShellExecution,
	tasks,
	TaskScope,
	ThemeIcon,
	Task as VscodeTask,
	window,
} from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import { basename } from '@gitlens/utils/path.js';
import type { Container } from '../container.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

export interface RunTaskOnWorktreeCommandArgs {
	worktreePath?: string;
	/** Run the stored default task without showing the picker; falls back to the picker (which then
	 *  stores the pick as the default) when no default exists or it no longer resolves. */
	useDefault?: boolean;
}

interface TaskQuickPickItem extends QuickPickItem {
	task?: Task;
	key?: string;
}

const maxRecentTasks = 5;

const defaultEmpty = new ThemeIcon('pass');
const defaultFilled = new ThemeIcon('pass-filled');

function defaultButton(isDefault: boolean): QuickInputButton {
	return {
		iconPath: isDefault ? defaultFilled : defaultEmpty,
		tooltip: isDefault ? 'Unset as Default Task' : 'Set as Default Task',
	};
}

/** Runs a VS Code task (or an ad-hoc shell command) with a worktree as its cwd. VS Code has no
 *  "run task with a different cwd" API, so we clone the task's execution rather than run it as-is. */
@command()
export class RunTaskOnWorktreeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.runTaskOnWorktree');
	}

	async execute(args?: RunTaskOnWorktreeCommandArgs): Promise<void> {
		const worktreePath = args?.worktreePath;
		if (worktreePath == null) return;

		let choosingDefault = false;
		if (args?.useDefault) {
			const defaultKey = this.container.storage.getWorkspace('worktrees:runTaskDefault');
			if (defaultKey != null) {
				let runnableTasks: Task[];
				try {
					runnableTasks = await this.getRunnableTasks();
				} catch (ex) {
					Logger.error(ex, 'RunTaskOnWorktreeCommand', 'fetchTasks');
					return;
				}

				const task = runnableTasks.find(t => this.getTaskKey(t) === defaultKey);
				if (task != null && (await this.runTask(task, defaultKey, worktreePath))) return;
			}

			choosingDefault = true;
		}

		await this.showPicker(worktreePath, choosingDefault);
	}

	private async showPicker(worktreePath: string, choosingDefault: boolean): Promise<void> {
		let currentDefault = this.container.storage.getWorkspace('worktrees:runTaskDefault');

		const quickpick = window.createQuickPick<TaskQuickPickItem>();
		quickpick.title = choosingDefault ? 'Choose Default Task for Worktree' : 'Run Task on Worktree';
		quickpick.placeholder = choosingDefault
			? `Choose the default task to run in ${basename(worktreePath)}`
			: `Choose a task to run in ${basename(worktreePath)} · mark a task's checkmark to set it as the default`;
		quickpick.busy = true;
		quickpick.show();

		let allItems: TaskQuickPickItem[] = [];
		const allTasksItem: TaskQuickPickItem = { label: '$(list-unordered) All Tasks...' };

		const disposables: Disposable[] = [];

		const withButton = (item: TaskQuickPickItem): TaskQuickPickItem => {
			item.buttons = [defaultButton(item.key === currentDefault)];
			return item;
		};

		// Refreshes every item's checkmark button after `currentDefault` changes. `allItems` (the "All
		// Tasks..." backing list) and `quickpick.items` (the currently displayed, possibly curated, list)
		// hold separate item instances for the same task, so both need their own pass.
		const refreshButtons = (activeItem: TaskQuickPickItem) => {
			for (const item of allItems) {
				if (item.key != null) {
					withButton(item);
				}
			}

			for (const item of quickpick.items) {
				if (item.key != null) {
					withButton(item);
				}
			}
			// Reassign to a new array — VS Code only re-renders items on an actual `items` set, not on
			// in-place mutation of the array/objects it already holds.
			quickpick.items = [...quickpick.items];
			quickpick.activeItems = [activeItem];
		};

		let picked: TaskQuickPickItem | undefined;
		try {
			picked = await new Promise<TaskQuickPickItem | undefined>(resolve => {
				disposables.push(
					quickpick.onDidAccept(() => {
						const item = quickpick.activeItems[0];
						if (item == null) return;

						if (item === allTasksItem) {
							quickpick.items = allItems;
							return;
						}

						resolve(item);
					}),
				);

				disposables.push(quickpick.onDidHide(() => resolve(undefined)));

				disposables.push(
					quickpick.onDidTriggerItemButton(e => {
						if (e.item.key == null) return;

						currentDefault = e.item.key === currentDefault ? undefined : e.item.key;
						void this.container.storage.storeWorkspace('worktrees:runTaskDefault', currentDefault);
						refreshButtons(e.item);
					}),
				);

				void this.getRunnableTasks()
					.then(runnableTasks => {
						const recentKeys = this.getRecentTaskKeys();
						const byKey = new Map(runnableTasks.map(t => [this.getTaskKey(t), t]));

						const recentItems: TaskQuickPickItem[] = [];
						for (const key of recentKeys) {
							const task = byKey.get(key);
							if (task == null) continue;

							recentItems.push(
								withButton({ label: task.name, description: task.source, task: task, key: key }),
							);
						}

						const bySource = new Map<string, Task[]>();
						for (const task of runnableTasks) {
							const list = bySource.get(task.source);
							if (list == null) {
								bySource.set(task.source, [task]);
							} else {
								list.push(task);
							}
						}

						const sources = [...bySource.keys()].sort((a, b) => {
							if (a === 'Workspace') return -1;
							if (b === 'Workspace') return 1;
							return 0;
						});

						const fullItems: TaskQuickPickItem[] = [];
						for (const source of sources) {
							fullItems.push({ label: source, kind: QuickPickItemKind.Separator });
							for (const task of bySource.get(source)!) {
								fullItems.push(
									withButton({
										label: task.name,
										description: task.source,
										task: task,
										key: this.getTaskKey(task),
									}),
								);
							}
						}

						allItems = fullItems;

						// The npm script provider alone can detect dozens of tasks, so the first level shows only
						// recents and tasks.json tasks; everything else sits behind "All Tasks...".
						const workspaceItems: TaskQuickPickItem[] = (bySource.get('Workspace') ?? [])
							.filter(t => !recentKeys.includes(this.getTaskKey(t)))
							.map(t =>
								withButton({ label: t.name, description: t.source, task: t, key: this.getTaskKey(t) }),
							);

						const items: TaskQuickPickItem[] = [];
						if (recentItems.length) {
							items.push({ label: 'Recent', kind: QuickPickItemKind.Separator }, ...recentItems);
						}

						if (workspaceItems.length) {
							items.push({ label: 'Workspace', kind: QuickPickItemKind.Separator }, ...workspaceItems);
						}

						items.push({ label: '', kind: QuickPickItemKind.Separator }, allTasksItem);

						quickpick.busy = false;
						// Nothing curated to offer — skip straight to the full list
						quickpick.items = items.length > 2 ? items : allItems;
					})
					.then(undefined, (ex: unknown) => {
						Logger.error(ex, 'RunTaskOnWorktreeCommand', 'fetchTasks');
						resolve(undefined);
					});
			});
		} finally {
			quickpick.dispose();
			for (const disposable of disposables) {
				disposable.dispose();
			}
		}

		if (picked == null) return;

		const task = picked.task;
		if (task == null || picked.key == null) return;

		if (choosingDefault) {
			await this.container.storage.storeWorkspace('worktrees:runTaskDefault', picked.key);
		}

		await this.runTask(task, picked.key, worktreePath);
	}

	/** Clones `task` for `worktreePath` and runs it, recording it as the most recent pick. Returns
	 *  whether the task actually ran (a `CustomExecution` task can't be cloned with a new cwd). */
	private async runTask(task: Task, key: string, worktreePath: string): Promise<boolean> {
		const clone = this.cloneTaskForWorktree(task, worktreePath);
		if (clone == null) return false;

		void tasks.executeTask(clone);
		await this.addRecentTaskKey(key);
		return true;
	}

	private async getRunnableTasks(): Promise<Task[]> {
		const allTasks = await tasks.fetchTasks();
		// A CustomExecution is an extension-owned callback with no cwd to override.
		return allTasks.filter(t => t.execution instanceof ShellExecution || t.execution instanceof ProcessExecution);
	}

	private cloneTaskForWorktree(task: Task, worktreePath: string): Task | undefined {
		const exec = task.execution;

		let newExec: ShellExecution | ProcessExecution | undefined;
		if (exec instanceof ShellExecution) {
			const env: Record<string, string> = { ...exec.options?.env, GITLENS_WORKTREE_PATH: worktreePath };
			const options: ShellExecutionOptions = { ...exec.options, cwd: worktreePath, env: env };
			newExec =
				exec.commandLine != null
					? new ShellExecution(exec.commandLine, options)
					: new ShellExecution(exec.command ?? '', exec.args ?? [], options);
		} else if (exec instanceof ProcessExecution) {
			const env: Record<string, string> = { ...exec.options?.env, GITLENS_WORKTREE_PATH: worktreePath };
			const options: ProcessExecutionOptions = { ...exec.options, cwd: worktreePath, env: env };
			newExec = new ProcessExecution(exec.process, exec.args, options);
		}

		if (newExec == null) return undefined;

		return new VscodeTask(
			task.definition,
			task.scope ?? TaskScope.Workspace,
			`${task.name} (${basename(worktreePath)})`,
			task.source,
			newExec,
			task.problemMatchers,
		);
	}

	private getTaskKey(task: Task): string {
		return `${task.source}:${task.name}`;
	}

	private getRecentTaskKeys(): string[] {
		const history = this.container.storage.getWorkspace('worktrees:runTaskHistory');
		// Tolerates the earlier per-worktree Record shape
		return Array.isArray(history) ? history : [];
	}

	private async addRecentTaskKey(key: string): Promise<void> {
		const existing = this.getRecentTaskKeys();

		const updated = [key, ...existing.filter(k => k !== key)].slice(0, maxRecentTasks);
		await this.container.storage.storeWorkspace('worktrees:runTaskHistory', updated);
	}
}
