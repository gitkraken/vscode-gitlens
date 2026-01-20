import type { Ignore } from 'ignore';
import ignore from 'ignore';
import { workspace } from 'vscode';
import type { Container } from '../../container.js';
import { configuration } from '../../system/-webview/configuration.js';
import { relative } from '../../system/-webview/path.js';
import { Logger } from '../../system/logger.js';
import { normalizePath } from '../../system/path.js';

/** AI ignore file names in priority order */
const aiIgnoreFileNames = ['.aiignore', '.cursorignore', '.aiexclude'] as const;

/**
 * Fallback defaults when settings are undefined (VS Code bug on extension upgrade).
 * These match the defaults in package.json.
 */
const defaultExcludeFiles: Record<string, boolean> = {
	'**/pnpm-lock.yaml': true,
	'**/package-lock.json': true,
	'**/yarn.lock': true,
	'**/Cargo.lock': true,
	'**/Gemfile.lock': true,
	'**/composer.lock': true,
	'**/Pipfile.lock': true,
	'**/poetry.lock': true,
	'**/go.sum': true,
	'**/*.min.js': true,
	'**/*.min.css': true,
	'**/*.map': true,
	'**/dist/**': true,
	'**/out/**': true,
	'**/build/**': true,
	'**/node_modules/**': true,
};

/**
 * In-memory cache for AI ignore patterns using the `ignore` npm package.
 * Supports VS Code settings and per-repo AI ignore files (.aiignore, .cursorignore, .aiexclude).
 *
 * Patterns are loaded eagerly on creation. Once loaded, all checks are synchronous.
 */
export class AIIgnoreCache {
	private _ignore: Ignore | undefined;
	private _loading: Promise<void> | undefined;

	constructor(
		private readonly container: Container,
		readonly repoPath: string,
	) {
		// Start loading patterns immediately
		this._loading = this.loadPatterns();
	}

	/**
	 * Excludes ignored paths, returning only those that are NOT ignored.
	 * More efficient than calling isIgnored for each path as patterns are loaded once.
	 * @param paths Paths relative to the repository root
	 * @returns Paths that are not ignored
	 */
	async excludeIgnored(paths: string[]): Promise<string[]> {
		const ig = await this.getIgnore();
		return paths.filter(path => !this.isIgnoredCore(ig, path));
	}

	/**
	 * Checks if a path should be ignored from AI prompts.
	 * @param path Path relative to the repository root
	 * @returns true if the path should be ignored
	 */
	async isIgnored(path: string): Promise<boolean> {
		return this.isIgnoredCore(await this.getIgnore(), path);
	}

	private isIgnoredCore(ig: Ignore, path: string): boolean {
		const relativePath = normalizePath(relative(this.repoPath, path) || path);
		if (!relativePath) return false;

		try {
			return ig.ignores(relativePath);
		} catch {
			// ignore can throw on invalid paths
			return false;
		}
	}

	private async getIgnore(): Promise<Ignore> {
		if (this._loading != null) {
			await this._loading;
		}
		return this._ignore!;
	}

	private async loadPatterns(): Promise<void> {
		const ig = ignore();

		try {
			// Load patterns from all sources
			this.loadConfigPatterns(ig);
			await this.loadRepoIgnoreFile(ig);
		} catch (ex) {
			Logger.error(ex, 'AIIgnoreCache.loadPatterns');
		}

		this._ignore = ig;
		this._loading = undefined;
	}

	private loadConfigPatterns(ig: Ignore): void {
		// Get patterns from settings (defaults are defined in package.json)
		// Fallback to hardcoded defaults if undefined (VS Code bug on extension upgrade)
		const excludeFiles = configuration.get('ai.exclude.files') ?? defaultExcludeFiles;

		// Add patterns that are enabled (true)
		for (const [pattern, enabled] of Object.entries(excludeFiles)) {
			if (enabled) {
				ig.add(pattern);
			}
		}
	}

	private async loadRepoIgnoreFile(ig: Ignore): Promise<void> {
		// Try each AI ignore file in priority order
		for (const fileName of aiIgnoreFileNames) {
			try {
				const filePath = `${this.repoPath}/${fileName}`;
				const bytes = await workspace.fs.readFile(this.container.git.getAbsoluteUri(filePath));
				const content = new TextDecoder().decode(bytes);
				ig.add(content);
				// Only use the first file found
				return;
			} catch {
				// File doesn't exist, try next one
			}
		}
	}
}
