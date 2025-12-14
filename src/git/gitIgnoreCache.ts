import type { Ignore } from 'ignore';
import ignore from 'ignore';
import type { Uri } from 'vscode';
import { Uri as VsCodeUri, workspace } from 'vscode';
import type { Container } from '../container';
import { relative } from '../system/-webview/path';
import { Logger } from '../system/logger';
import { isAbsolute, normalizePath } from '../system/path';

export type GlobalExcludesPathProvider = () => Promise<string | undefined>;

/**
 * In-memory cache for .gitignore patterns using the `ignore` npm package.
 * Much faster than shelling out to `git check-ignore` for high-frequency operations.
 *
 * Patterns are loaded eagerly on creation. Once loaded, all checks are synchronous.
 */
export class GitIgnoreCache {
	private _ignore: Ignore | undefined;
	private _loading: Promise<void> | undefined;

	constructor(
		private readonly container: Container,
		readonly repoPath: string,
		private readonly getGlobalExcludesPath: GlobalExcludesPathProvider,
	) {
		// Start loading patterns immediately
		this._loading = this.loadPatterns();
	}

	/**
	 * Excludes ignored URIs, returning only those that are NOT ignored.
	 * @param uris URIs to filter
	 * @returns URIs that are not ignored
	 */
	async excludeIgnored(uris: Uri[]): Promise<Uri[]> {
		const ig = await this.getIgnore();

		const results: Uri[] = [];
		for (const uri of uris) {
			if (this.isIgnoredCore(ig, uri)) continue;

			results.push(uri);
		}
		return results;
	}

	/**
	 * Checks if a path is ignored by .gitignore rules.
	 * @param pathOrUri Path relative to the repository root, or a Uri
	 * @returns true if the path should be ignored
	 */
	async isIgnored(pathOrUri: string | Uri): Promise<boolean> {
		return this.isIgnoredCore(await this.getIgnore(), pathOrUri);
	}

	private isIgnoredCore(ig: Ignore, pathOrUri: string | Uri): boolean {
		const relativePath =
			typeof pathOrUri === 'string' ? pathOrUri : normalizePath(relative(this.repoPath, pathOrUri.fsPath));
		if (!relativePath) return false;

		try {
			return ig.ignores(relativePath);
		} catch {
			// ignore can throw on invalid paths (e.g., paths starting with ./)
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
			// Load patterns from all gitignore sources
			await Promise.all([this.loadGitignoreFile(ig), this.loadGitInfoExclude(ig), this.loadGlobalExcludes(ig)]);
		} catch (ex) {
			Logger.error(ex, 'GitIgnoreCache.loadPatterns');
		}

		this._ignore = ig;
		this._loading = undefined;
	}

	private async loadGitignoreFile(ig: Ignore): Promise<void> {
		try {
			const gitignorePath = `${this.repoPath}/.gitignore`;
			const bytes = await workspace.fs.readFile(this.container.git.getAbsoluteUri(gitignorePath));
			const content = new TextDecoder().decode(bytes);
			ig.add(content);
		} catch {
			// .gitignore might not exist
		}
	}

	private async loadGitInfoExclude(ig: Ignore): Promise<void> {
		try {
			const excludePath = `${this.repoPath}/.git/info/exclude`;
			const bytes = await workspace.fs.readFile(this.container.git.getAbsoluteUri(excludePath));
			const content = new TextDecoder().decode(bytes);
			ig.add(content);
		} catch {
			// .git/info/exclude might not exist
		}
	}

	private async loadGlobalExcludes(ig: Ignore): Promise<void> {
		try {
			// Get the global excludes file path from git config
			const globalExcludesPath = await this.getGlobalExcludesPath();
			if (!globalExcludesPath) return;

			// Global excludes path can be absolute or relative (to home directory)
			const uri = isAbsolute(globalExcludesPath)
				? VsCodeUri.file(globalExcludesPath)
				: this.container.git.getAbsoluteUri(globalExcludesPath);

			const bytes = await workspace.fs.readFile(uri);
			const content = new TextDecoder().decode(bytes);
			ig.add(content);
		} catch {
			// Global excludes file might not exist
		}
	}
}
