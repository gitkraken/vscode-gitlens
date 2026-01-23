/* eslint-disable no-restricted-globals */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class GitFixture {
	constructor(public readonly repoPath: string) {}

	/**
	 * Add a remote
	 * @param name Remote name
	 * @param url Remote URL
	 */
	async addRemote(name: string, url: string): Promise<void> {
		await this.git('remote', undefined, 'add', name, url);
	}

	async branch(name: string): Promise<void> {
		await this.git('branch', undefined, name);
	}

	/**
	 * Delete a branch
	 * @param name Branch name
	 * @param force Force delete even if not fully merged
	 */
	async deleteBranch(name: string, force: boolean = true): Promise<void> {
		await this.git('branch', undefined, force ? '-D' : '-d', name);
	}

	async checkout(name: string, create: boolean = false): Promise<void> {
		if (create) {
			await this.git('checkout', undefined, '-b', name);
		} else {
			await this.git('checkout', undefined, name);
		}
	}

	/**
	 * Clean untracked files and directories
	 */
	async clean(): Promise<void> {
		await this.git('clean', undefined, '-fd');
	}

	/**
	 * Clean up all Git rebase state files and directories.
	 * This is useful for ensuring a clean state between tests.
	 */
	async cleanupRebaseState(): Promise<void> {
		try {
			await fs.rm(path.join(this.repoPath, '.git', 'rebase-merge'), { recursive: true, force: true });
		} catch {}
		try {
			await fs.rm(path.join(this.repoPath, '.git', 'rebase-apply'), { recursive: true, force: true });
		} catch {}
		try {
			await fs.unlink(path.join(this.repoPath, '.git', 'REBASE_HEAD'));
		} catch {}
		try {
			await fs.unlink(path.join(this.repoPath, '.git', 'index.lock'));
		} catch {}
		try {
			await fs.unlink(path.join(this.repoPath, '.git', 'HEAD.lock'));
		} catch {}
		await new Promise(resolve => setTimeout(resolve, 500));
	}

	async commit(message: string, fileName: string = 'test-file.txt', content: string = 'content'): Promise<void> {
		const filePath = path.join(this.repoPath, fileName);
		await fs.writeFile(filePath, content);
		await this.git('add', undefined, fileName);
		await this.git('commit', undefined, '-m', message);
	}

	/**
	 * Create a file with content (without staging)
	 * @param fileName File name relative to repo root
	 * @param content File content
	 */
	async createFile(fileName: string, content: string): Promise<void> {
		const filePath = path.join(this.repoPath, fileName);
		await fs.writeFile(filePath, content);
	}

	/**
	 * Create a fake remote tracking branch ref.
	 * Useful for testing upstream flows without a real remote.
	 * @param remote Remote name (e.g., "origin")
	 * @param branch Branch name (e.g., "main")
	 * @param ref The ref to point to (default: HEAD)
	 */
	async createRemoteBranch(remote: string, branch: string, ref: string = 'HEAD'): Promise<void> {
		const sha = await this.git('rev-parse', undefined, ref);
		await this.git('update-ref', undefined, `refs/remotes/${remote}/${branch}`, sha.trim());
	}

	/**
	 * Fetch from a remote
	 * @param remote Remote name (optional, defaults to all)
	 */
	async fetch(remote?: string): Promise<void> {
		if (remote) {
			await this.git('fetch', undefined, remote);
		} else {
			await this.git('fetch', undefined, '--all');
		}
	}

	/**
	 * Get the subject (first line) of the commit message
	 */
	async getCommitMessage(ref: string = 'HEAD'): Promise<string> {
		return (await this.git('show', undefined, '-s', '--format=%s', ref)).trim();
	}

	/**
	 * Get the current branch name
	 */
	async getCurrentBranch(): Promise<string> {
		return this.git('rev-parse', undefined, '--abbrev-ref', 'HEAD');
	}

	/**
	 * Get the path to the rebase todo file (only valid during an interactive rebase)
	 */
	getRebaseTodoPath(): string {
		return path.join(this.repoPath, '.git', 'rebase-merge', 'git-rebase-todo');
	}

	async getShortSha(ref: string = 'HEAD'): Promise<string> {
		return this.git('rev-parse', undefined, '--short', ref);
	}

	async init(): Promise<void> {
		await fs.mkdir(this.repoPath, { recursive: true });
		await this.git('init', undefined, '-b', 'main');
		// Configure user for commits
		await this.git('config', undefined, 'user.email', 'you@example.com');
		await this.git('config', undefined, 'user.name', 'Your Name');
		// Initial commit to have a HEAD
		await this.commit('Initial commit');
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

	/**
	 * Abort an in-progress rebase
	 */
	async rebaseAbort(): Promise<void> {
		await this.git('rebase', undefined, '--abort');
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
	 * Reset the repository to a specific ref
	 * @param ref The ref to reset to (default: HEAD)
	 * @param mode The reset mode: 'soft', 'mixed', or 'hard' (default: 'hard')
	 */
	async reset(ref: string = 'HEAD', mode: 'soft' | 'mixed' | 'hard' = 'hard'): Promise<void> {
		await this.git('reset', undefined, `--${mode}`, ref);
	}

	/**
	 * Set an upstream tracking branch for a local branch.
	 * If the upstream doesn't exist, this creates a "missing upstream" scenario
	 * useful for testing branch prune functionality.
	 * @param branch Local branch name
	 * @param upstream Upstream in format "remote/branch" (e.g., "origin/feature-old")
	 */
	async setUpstream(branch: string, upstream: string): Promise<void> {
		// Set the upstream config directly (works even if the remote branch doesn't exist)
		const [remote, ...branchParts] = upstream.split('/');
		const remoteBranch = branchParts.join('/');
		await this.git('config', undefined, `branch.${branch}.remote`, remote);
		await this.git('config', undefined, `branch.${branch}.merge`, `refs/heads/${remoteBranch}`);
	}

	/**
	 * Stage a file
	 * @param fileName File name relative to repo root
	 */
	async stage(fileName: string): Promise<void> {
		await this.git('add', undefined, fileName);
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
	 * Create a stash with the current working directory changes
	 * @param message Optional stash message
	 * @param options Options for the stash
	 */
	async stash(message?: string, options?: { includeUntracked?: boolean; staged?: boolean }): Promise<void> {
		const args = ['push'];
		if (message) {
			args.push('-m', message);
		}
		if (options?.includeUntracked) {
			args.push('--include-untracked');
		}
		if (options?.staged) {
			args.push('--staged');
		}
		await this.git('stash', undefined, ...args);
	}

	/**
	 * Create a tag at the current HEAD or specified ref
	 * @param name Tag name
	 * @param options Optional: message for annotated tag, ref to tag
	 */
	async tag(name: string, options?: { message?: string; ref?: string }): Promise<void> {
		const args = [name];
		if (options?.message) {
			args.unshift('-a', '-m', options.message);
		}
		if (options?.ref) {
			args.push(options.ref);
		}
		await this.git('tag', undefined, ...args);
	}

	async worktree(worktreePath: string, branch: string): Promise<void> {
		await this.git('worktree', undefined, 'add', worktreePath, branch);
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
