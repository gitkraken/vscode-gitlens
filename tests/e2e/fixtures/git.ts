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
		await this.git('config', 'user.email', 'you@example.com');
		await this.git('config', 'user.name', 'Your Name');
		// Initial commit to have a HEAD
		await this.commit('Initial commit');
	}

	async commit(message: string, fileName: string = 'test-file.txt', content: string = 'content'): Promise<void> {
		const filePath = path.join(this.repoPath, fileName);
		await fs.writeFile(filePath, content);
		await this.git('add', fileName);
		await this.git('commit', '-m', message);
	}

	async branch(name: string): Promise<void> {
		await this.git('branch', name);
	}

	async checkout(name: string, create: boolean = false): Promise<void> {
		if (create) {
			await this.git('checkout', '-b', name);
		} else {
			await this.git('checkout', name);
		}
	}

	async worktree(worktreePath: string, branch: string): Promise<void> {
		await this.git('worktree', 'add', worktreePath, branch);
	}

	/**
	 * Start an interactive rebase. This will open the rebase editor.
	 * @param onto The commit or ref to rebase onto (e.g., 'HEAD~3')
	 * @param env Additional environment variables
	 */
	async rebaseInteractive(onto: string, env?: Record<string, string>): Promise<void> {
		await this.git('rebase', '-i', onto, env);
	}

	/**
	 * Abort an in-progress rebase
	 */
	async rebaseAbort(): Promise<void> {
		await this.git('rebase', '--abort');
	}

	/**
	 * Get the current branch name
	 */
	async getCurrentBranch(): Promise<string> {
		return this.git('rev-parse', '--abbrev-ref', 'HEAD');
	}

	/**
	 * Get the short SHA of a ref
	 */
	async getShortSha(ref: string = 'HEAD'): Promise<string> {
		return this.git('rev-parse', '--short', ref);
	}

	/**
	 * Check if a rebase is in progress
	 */
	async isRebaseInProgress(): Promise<boolean> {
		try {
			await this.git('rev-parse', '--verify', 'REBASE_HEAD');
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
		await this.git('reset', `--${mode}`, ref);
	}

	/**
	 * Clean untracked files and directories
	 */
	async clean(): Promise<void> {
		await this.git('clean', '-fd');
	}

	private async git(command: string, ...args: (string | Record<string, string> | undefined)[]): Promise<string> {
		// Separate command args from env options
		const cmdArgs: string[] = [];
		let envOverrides: Record<string, string> | undefined;

		for (const arg of args) {
			if (typeof arg === 'string') {
				cmdArgs.push(arg);
			} else if (typeof arg === 'object' && arg !== null) {
				envOverrides = arg;
			}
		}

		const fullArgs = [command, ...cmdArgs];
		return new Promise((resolve, reject) => {
			const child = spawn('git', fullArgs, {
				cwd: this.repoPath,
				env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
			});
			let stdout = '';
			let stderr = '';

			child.stdout.on('data', (data: string | Buffer) => (stdout += data.toString()));
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
