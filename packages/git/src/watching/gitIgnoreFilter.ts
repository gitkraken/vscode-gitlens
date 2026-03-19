import { getScopedCounter } from '@gitlens/utils/counter.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { Ignore } from 'ignore';
import ignore from 'ignore';
import type { FileSystemProvider } from '../context.js';

export interface GitIgnoreFilterOptions {
	/** Absolute path to the repository root (working tree) */
	readonly repoPath: string;
	/** Absolute path to the .git directory (for info/exclude) */
	readonly gitDirPath: string;
	/** File system provider for reading ignore files */
	readonly fs: FileSystemProvider;
	/**
	 * Returns the path to the global excludes file (core.excludesFile).
	 * May return undefined if not configured.
	 */
	readonly getGlobalExcludesPath?: () => Promise<string | undefined>;
}

/**
 * In-memory gitignore filter using the `ignore` npm package.
 * Fully library-owned — no VS Code dependencies.
 *
 * Loads patterns eagerly on creation from:
 * 1. `<repoPath>/.gitignore`
 * 2. `<gitDirPath>/info/exclude`
 * 3. Global excludes file (`core.excludesFile`)
 *
 * Once loaded, all checks are **synchronous** for maximum performance.
 * Call `ready()` before first use to ensure patterns are loaded.
 */
export class GitIgnoreFilter {
	private ig: Ignore = ignore();
	private loading: Promise<void> | undefined;
	private readonly _generation = getScopedCounter();

	private readonly repoPath: string;
	private readonly gitDirPath: string;
	private readonly fs: FileSystemProvider;
	private readonly getGlobalExcludesPath?: () => Promise<string | undefined>;

	constructor(options: GitIgnoreFilterOptions) {
		this.repoPath = options.repoPath;
		this.gitDirPath = options.gitDirPath;
		this.fs = options.fs;
		this.getGlobalExcludesPath = options.getGlobalExcludesPath;

		// Start loading immediately
		this.loading = this.loadPatterns();
	}

	/** Resolves when patterns are loaded. Safe to call multiple times. */
	async ready(): Promise<void> {
		if (this.loading != null) {
			await this.loading;
		}
	}

	/**
	 * Check if a path is ignored. Must be called after `ready()`.
	 * @param relativePath Path relative to the repository root (forward slashes)
	 * @returns true if the path should be ignored
	 */
	isIgnored(relativePath: string): boolean {
		if (!relativePath) return false;

		try {
			return this.ig.ignores(relativePath);
		} catch {
			// `ignore` can throw on edge-case paths
			return false;
		}
	}

	/**
	 * Filter an array of relative paths, returning only non-ignored ones.
	 * Must be called after `ready()`.
	 */
	filter(relativePaths: readonly string[]): string[] {
		return this.ig.filter(relativePaths);
	}

	/**
	 * Reload all patterns (e.g., after .gitignore or info/exclude changes).
	 * Returns a promise that resolves when reload is complete.
	 */
	async refresh(): Promise<void> {
		this.loading = this.loadPatterns();
		await this.loading;
	}

	private async loadPatterns(): Promise<void> {
		const id = this._generation.next();
		const newIg = ignore();

		await Promise.allSettled([
			this.loadFile(newIg, `${this.repoPath}/.gitignore`),
			this.loadFile(newIg, `${this.gitDirPath}/info/exclude`),
			this.loadGlobalExcludes(newIg),
		]);

		// Only commit results if no newer refresh has started
		if (id !== this._generation.current) return;

		this.ig = newIg;
		this.loading = undefined;
	}

	private async loadFile(target: Ignore, path: string): Promise<void> {
		try {
			const data = await this.fs.readFile(fileUri(path));
			const content = new TextDecoder().decode(data);
			if (content) {
				target.add(content);
			}
		} catch {
			// File might not exist or be unreadable — that's fine
		}
	}

	private async loadGlobalExcludes(target: Ignore): Promise<void> {
		if (this.getGlobalExcludesPath == null) return;

		try {
			const path = await this.getGlobalExcludesPath();
			if (path != null) {
				await this.loadFile(target, path);
			}
		} catch {
			// Global excludes might not be configured
		}
	}
}
