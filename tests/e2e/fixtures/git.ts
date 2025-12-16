/* eslint-disable no-restricted-globals */
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

export class GitFixture {
	constructor(private readonly repoPath: string) {}

	get repoDir(): string {
		return this.repoPath;
	}

	async init(): Promise<void> {
		await fs.mkdir(this.repoPath, { recursive: true });
		await this.git('init');
		// Configure user for commits
		await this.git('config', undefined, 'user.email', 'you@example.com');
		await this.git('config', undefined, 'user.name', 'Your Name');
		// Initial commit to have a HEAD
		await this.commit('Initial commit');
	}

	async commit(message: string, fileName: string = 'test-file.txt', content: string = 'content'): Promise<void> {
		const filePath = path.join(this.repoPath, fileName);
		await fs.writeFile(filePath, content);
		await this.git('add', undefined, fileName);
		await this.git('commit', undefined, '-m', message);
	}

	async branch(name: string): Promise<void> {
		await this.git('branch', undefined, name);
	}

	async checkout(name: string, create: boolean = false): Promise<void> {
		if (create) {
			await this.git('checkout', undefined, '-b', name);
		} else {
			await this.git('checkout', undefined, name);
		}
	}

	async worktree(worktreePath: string, branch: string): Promise<void> {
		await this.git('worktree', undefined, 'add', worktreePath, branch);
	}

	/**
	 * Start an interactive rebase. This will open the rebase editor.
	 * @param onto The commit or ref to rebase onto (e.g., 'HEAD~3')
	 * @param options Options for the rebase
	 * @param options.sequenceEditor Command to use as the sequence editor (e.g., VS Code path with --wait)
	 */
	async rebaseInteractive(
		onto: string,
		options?: { sequenceEditor?: string; rebaseMerges?: boolean },
	): Promise<void> {
		const configs: string[] = [];
		if (options?.sequenceEditor) {
			configs.push('-c', `sequence.editor=${options?.sequenceEditor}`);
		}
		const args = [];
		if (options?.rebaseMerges) {
			args.push('--rebase-merges');
		}
		args.push('-i', onto);

		await this.git('rebase', { configs: configs }, ...args.slice(1));
	}

	/**
	 * Start an interactive rebase using a wait editor that allows the test to control when	 * the rebase completes. Returns helpers to wait for the todo file and signal completion.
	 * @param onto The commit or ref to rebase onto
	 */
	startRebaseInteractiveWithWaitEditor(
		onto: string,
		options?: { rebaseMerges?: boolean; updateRefs?: boolean },
	): {
		rebasePromise: Promise<string>;
		waitForTodoFile: () => Promise<string>;
		signalEditorDone: () => Promise<void>;
		signalEditorAbort: () => Promise<void>;
	} {
		const waitEditorPath = path.join(__dirname, '../../../scripts/tests/waitEditor.mjs');
		const sequenceEditor = `"${process.execPath}" "${waitEditorPath}"`;

		const configs: string[] = ['-c', `sequence.editor=${sequenceEditor}`];

		const args = [];
		if (options?.rebaseMerges) {
			args.push('--rebase-merges');
		}
		if (options?.updateRefs) {
			args.push('--update-refs');
		}
		args.push('-i', onto);

		// The todo file path - we'll get the actual path from the .ready file
		let todoFilePath: string | undefined;

		const rebasePromise = this.git('rebase', { configs: configs }, ...args);

		const waitForTodoFile = async (): Promise<string> => {
			// Poll for the .ready file which contains the todo file path
			const rebaseMergeDir = path.join(this.repoPath, '.git', 'rebase-merge');
			const expectedTodoPath = path.join(rebaseMergeDir, 'git-rebase-todo');
			const readyFile = `${expectedTodoPath}.ready`;

			const maxWait = 10000;
			const start = Date.now();
			while (Date.now() - start < maxWait) {
				try {
					todoFilePath = (await fs.readFile(readyFile, 'utf-8')).trim();
					if (!path.isAbsolute(todoFilePath)) {
						todoFilePath = path.join(this.repoPath, todoFilePath);
					}
					return todoFilePath;
				} catch {
					await new Promise(resolve => setTimeout(resolve, 100));
				}
			}
			throw new Error('Timeout waiting for rebase todo file');
		};

		const signalEditorDone = async (): Promise<void> => {
			if (!todoFilePath) {
				throw new Error('Must call waitForTodoFile first');
			}
			const doneFile = `${todoFilePath}.done`;
			await fs.writeFile(doneFile, 'done');
		};

		const signalEditorAbort = async (): Promise<void> => {
			if (!todoFilePath) {
				throw new Error('Must call waitForTodoFile first');
			}
			const abortFile = `${todoFilePath}.abort`;
			await fs.writeFile(abortFile, 'abort');
		};

		return {
			rebasePromise: rebasePromise,
			waitForTodoFile: waitForTodoFile,
			signalEditorDone: signalEditorDone,
			signalEditorAbort: signalEditorAbort,
		};
	}

	/**
	 * Get the path to the rebase todo file (only valid during an interactive rebase)
	 */
	getRebaseTodoPath(): string {
		return path.join(this.repoPath, '.git', 'rebase-merge', 'git-rebase-todo');
	}

	/**
	 * Abort an in-progress rebase
	 */
	async rebaseAbort(): Promise<void> {
		await this.git('rebase', undefined, '--abort');
	}

	/**
	 * Get the current branch name
	 */
	async getCurrentBranch(): Promise<string> {
		return this.git('rev-parse', undefined, '--abbrev-ref', 'HEAD');
	}

	async getShortSha(ref: string = 'HEAD'): Promise<string> {
		return this.git('rev-parse', undefined, '--short', ref);
	}

	/**
	 * Get the subject (first line) of the commit message
	 */
	async getCommitMessage(ref: string = 'HEAD'): Promise<string> {
		return (await this.git('show', undefined, '-s', '--format=%s', ref)).trim();
	}

	/**
	 * Check if a rebase is in progress by looking for REBASE_HEAD
	 */
	async isRebaseInProgress(): Promise<boolean> {
		try {
			await this.git('rev-parse', undefined, '--verify', 'REBASE_HEAD');
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Reset the repository to a specific ref
	 * @param ref The ref to reset to (default: HEAD)
	 * @param mode The reset mode: 'soft', 'mixed', or 'hard' (default: 'hard')
	 */
	async reset(ref: string = 'HEAD', mode: 'soft' | 'mixed' | 'hard' = 'hard'): Promise<void> {
		await this.git('reset', undefined, `--${mode}`, ref);
	}

	/**
	 * Clean untracked files and directories
	 */
	async clean(): Promise<void> {
		await this.git('clean', undefined, '-fd');
	}

	/**
	 * Merge a branch into the current branch
	 * @param branch The branch to merge
	 * @param message Optional commit message for the merge
	 * @param options Optional merge options
	 */
	async merge(branch: string, message?: string, options?: { noFF?: boolean }): Promise<void> {
		const args = [];
		if (options?.noFF) {
			args.push('--no-ff');
		}
		args.push(branch);
		if (message) {
			args.push('-m', message);
		}
		await this.git('merge', undefined, ...args);
	}

	private async git(command: string, options?: { configs?: string[] }, ...args: string[]): Promise<string> {
		const fullArgs = [...(options?.configs ?? []), command, ...args];
		return new Promise((resolve, reject) => {
			const child = spawn('git', fullArgs, { cwd: this.repoPath, env: process.env });

			let stdout = '';
			child.stdout.on('data', (data: string | Buffer) => (stdout += data.toString()));

			let stderr = '';
			child.stderr.on('data', (data: string | Buffer) => (stderr += data.toString()));

			child.on('close', code => {
				if (code === 0) {
					resolve(stdout.trim());
				} else {
					reject(new Error(`Git command failed: git ${fullArgs.join(' ')}\n${stderr}`));
				}
			});
		});
	}
}
