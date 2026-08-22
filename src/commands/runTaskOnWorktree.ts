import type { ProcessExecutionOptions, ShellExecutionOptions, Task } from 'vscode';
import {
	ProcessExecution,
	QuickPickItemKind,
	ShellExecution,
	tasks,
	TaskScope,
	Task as VscodeTask,
	window,
} from 'vscode';
import { basename } from '@gitlens/utils/path.js';
import type { Container } from '../container.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

export interface RunTaskOnWorktreeCommandArgs {
	worktreePath?: string;
}

interface TaskQuickPickItem {
	label: string;
	description?: string;
	kind?: QuickPickItemKind;
	task?: Task;
	key?: string;
}

const maxRecentTasks = 5;

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

		const allTasks = await tasks.fetchTasks();
		// A CustomExecution is an extension-owned callback with no cwd to override.
		const runnableTasks = allTasks.filter(
			t => t.execution instanceof ShellExecution || t.execution instanceof ProcessExecution,
		);

		const recentKeys = this.getRecentTaskKeys(worktreePath);
		const byKey = new Map(runnableTasks.map(t => [this.getTaskKey(t), t]));

		const recentItems: TaskQuickPickItem[] = [];
		for (const key of recentKeys) {
			const task = byKey.get(key);
			if (task == null) continue;

			recentItems.push({ label: task.name, description: task.source, task: task, key: key });
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

		const allItems: TaskQuickPickItem[] = [];
		for (const source of sources) {
			allItems.push({ label: source, kind: QuickPickItemKind.Separator });
			for (const task of bySource.get(source)!) {
				allItems.push({ label: task.name, description: task.source, task: task, key: this.getTaskKey(task) });
			}
		}

		// The npm script provider alone can detect dozens of tasks, so the first level shows only
		// recents and tasks.json tasks; everything else sits behind "All Tasks...".
		const workspaceItems: TaskQuickPickItem[] = (bySource.get('Workspace') ?? [])
			.filter(t => !recentKeys.includes(this.getTaskKey(t)))
			.map(t => ({ label: t.name, description: t.source, task: t, key: this.getTaskKey(t) }));

		const allTasksItem: TaskQuickPickItem = { label: '$(list-unordered) All Tasks...' };

		const items: TaskQuickPickItem[] = [];
		if (recentItems.length) {
			items.push({ label: 'Recent', kind: QuickPickItemKind.Separator }, ...recentItems);
		}

		if (workspaceItems.length) {
			items.push({ label: 'Workspace', kind: QuickPickItemKind.Separator }, ...workspaceItems);
		}

		items.push({ label: '', kind: QuickPickItemKind.Separator }, allTasksItem);

		const options = {
			title: 'Run Task on Worktree',
			placeHolder: `Choose a task to run in ${basename(worktreePath)}`,
		};

		// Nothing curated to offer — skip straight to the full list
		let picked =
			items.length > 2
				? await window.showQuickPick(items, options)
				: await window.showQuickPick(allItems, options);
		if (picked === allTasksItem) {
			picked = await window.showQuickPick(allItems, options);
		}

		if (picked == null) return;

		const task = picked.task;
		if (task == null || picked.key == null) return;

		const clone = this.cloneTaskForWorktree(task, worktreePath);
		if (clone == null) return;

		void tasks.executeTask(clone);
		await this.addRecentTaskKey(worktreePath, picked.key);
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

	private getRecentTaskKeys(worktreePath: string): string[] {
		return this.container.storage.getWorkspace('worktrees:runTaskHistory')?.[worktreePath] ?? [];
	}

	private async addRecentTaskKey(worktreePath: string, key: string): Promise<void> {
		const history = this.container.storage.getWorkspace('worktrees:runTaskHistory') ?? {};
		const existing = history[worktreePath] ?? [];

		const updated = [key, ...existing.filter(k => k !== key)].slice(0, maxRecentTasks);
		await this.container.storage.storeWorkspace('worktrees:runTaskHistory', {
			...history,
			[worktreePath]: updated,
		});
	}
}
