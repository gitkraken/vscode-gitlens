import type { Ignore } from 'ignore';
import ignore from 'ignore';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import { isLinux } from '@gitlens/utils/platform.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { FileSystemProvider } from '../context.js';

/**
 * Case sensitivity when `core.ignorecase` is unset or unreadable. `ignore` matches case-insensitively by default, but
 * git follows `core.ignorecase` — false on Linux (and on a case-sensitive macOS volume), where matching `Build/`
 * against `build/` would call a real change ignored and drop it.
 */
const defaultIgnoreCase = !isLinux;

export interface GitIgnoreFilterOptions {
	/** Absolute path to the repository root (working tree) */
	readonly repoPath: string;
	/** Absolute path to the .git directory (for info/exclude when `getInfoExcludePath` isn't provided) */
	readonly gitDirPath: string;
	/** File system provider for reading ignore files */
	readonly fs: FileSystemProvider;
	/**
	 * Returns the path to the global excludes file (core.excludesFile).
	 * May return undefined if not configured.
	 */
	readonly getGlobalExcludesPath?: () => Promise<string | undefined>;
	/**
	 * Returns the absolute path to `info/exclude`, which lives in the COMMON git dir for a linked worktree.
	 * When provided, replaces the `gitDirPath`-based resolution; undefined means there is none to read.
	 */
	readonly getInfoExcludePath?: () => Promise<string | undefined>;
	/**
	 * Returns the repo-relative, `/`-separated paths of every `.gitignore` git reads (root included).
	 * Without it, only the root `.gitignore` is honoured.
	 */
	readonly getGitIgnorePaths?: () => Promise<readonly string[]>;
	/**
	 * Returns `core.ignorecase`, which decides whether patterns match case-insensitively. Undefined (or a failed read)
	 * falls back to the platform default (case-sensitive on Linux only).
	 */
	readonly getIgnoreCase?: () => Promise<boolean | undefined>;
}

/**
 * In-memory gitignore filter using the `ignore` npm package.
 * Fully library-owned — no VS Code dependencies.
 *
 * Loads patterns eagerly on creation, in git's precedence order (lowest first):
 * 1. Global excludes file (`core.excludesFile`)
 * 2. `info/exclude`
 * 3. `<repoPath>/.gitignore`
 * 4. Nested `.gitignore` files (via `getGitIgnorePaths`), deeper overriding shallower
 *
 * Once loaded, all checks are **synchronous** for maximum performance.
 * Call `ready()` before first use to ensure patterns are loaded.
 */
export class GitIgnoreFilter {
	private ig: Ignore = ignore({ ignorecase: defaultIgnoreCase });
	/** Matchers for nested `.gitignore` files, keyed by their repo-relative directory (no trailing slash) */
	private nested: Map<string, Ignore> | undefined;
	/** The newest load, which {@link ready} waits for; cleared once it settles */
	private loading: Promise<void> | undefined;
	/** The load running now; at most one runs at a time */
	private inflight: Promise<void> | undefined;
	/** The one load queued behind {@link inflight}, which every refresh made meanwhile shares */
	private trailing: Promise<void> | undefined;
	private readonly _generation = getScopedCounter();

	// Reused across `isIgnored` calls (which are synchronous, so never interleave) to avoid per-event allocations
	private readonly _scratchMatchers: Ignore[] = [];
	private readonly _scratchBases: number[] = [];

	private readonly repoPath: string;
	private readonly gitDirPath: string;
	private readonly fs: FileSystemProvider;
	private readonly getGlobalExcludesPath?: () => Promise<string | undefined>;
	private readonly getInfoExcludePath?: () => Promise<string | undefined>;
	private readonly getGitIgnorePaths?: () => Promise<readonly string[]>;
	private readonly getIgnoreCase?: () => Promise<boolean | undefined>;

	constructor(options: GitIgnoreFilterOptions) {
		this.repoPath = options.repoPath;
		this.gitDirPath = options.gitDirPath;
		this.fs = options.fs;
		this.getGlobalExcludesPath = options.getGlobalExcludesPath;
		this.getInfoExcludePath = options.getInfoExcludePath;
		this.getGitIgnorePaths = options.getGitIgnorePaths;
		this.getIgnoreCase = options.getIgnoreCase;

		// Start loading immediately
		void this.startLoad();
	}

	/** Resolves when patterns are loaded. Safe to call multiple times. */
	async ready(): Promise<void> {
		if (this.loading != null) {
			await this.loading;
		}
	}

	/**
	 * Check if a path is ignored. Must be called after `ready()`.
	 * Errs toward "not ignored": a false "ignored" drops a real change, a false "not ignored" only costs a refresh.
	 * @param relativePath Path relative to the repository root (forward slashes; a trailing slash marks a directory)
	 * @returns true if the path should be ignored
	 */
	isIgnored(relativePath: string): boolean {
		if (!relativePath) return false;

		try {
			if (this.nested == null) return this.ig.ignores(relativePath);

			return this.isIgnoredNested(relativePath, this.nested);
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
		return relativePaths.filter(p => !this.isIgnored(p));
	}

	/**
	 * Reload all patterns (e.g., after a .gitignore or info/exclude changes), rediscovering nested `.gitignore` files.
	 * Returns a promise that resolves when a reload started after this call is complete.
	 *
	 * Single-flight: an idle filter reloads at once, but while a reload runs, every further call shares one reload
	 * queued behind it — a checkout touching many `.gitignore` files costs two reloads, not one per file.
	 */
	refresh(): Promise<void> {
		if (this.inflight == null) return this.startLoad();

		if (this.trailing == null) {
			const run = (): Promise<void> => {
				this.trailing = undefined;
				return this.startLoad();
			};
			this.trailing = this.inflight.then(run, run);
		}
		this.loading = this.trailing;
		return this.trailing;
	}

	private startLoad(): Promise<void> {
		const load: Promise<void> = this.loadPatterns().finally(() => {
			if (this.inflight === load) {
				this.inflight = undefined;
			}
			if (this.loading === load) {
				this.loading = undefined;
			}
		});
		this.inflight = load;
		this.loading = load;
		return load;
	}

	/**
	 * Mirrors git's directory walk: each ancestor directory is checked shallow→deep, and the first one found ignored
	 * ignores the whole path (git never descends into it, so nothing below can re-include it). At each level, the
	 * matchers whose directory is a proper ancestor apply, and the deepest decisive one wins, falling back to the root.
	 */
	private isIgnoredNested(path: string, nested: Map<string, Ignore>): boolean {
		const matchers = this._scratchMatchers;
		const bases = this._scratchBases;

		try {
			// A trailing slash belongs to the path itself (a directory form), not to an ancestor
			const last = path.length - 1;

			let slash = path.indexOf('/');
			while (slash !== -1 && slash < last) {
				if (this.isLevelIgnored(path, slash + 1, matchers, bases)) return true;

				// A directory's own `.gitignore` applies below it, never to the directory itself
				const matcher = nested.get(path.slice(0, slash));
				if (matcher != null) {
					matchers.push(matcher);
					bases.push(slash + 1);
				}

				slash = path.indexOf('/', slash + 1);
			}

			return this.isLevelIgnored(path, path.length, matchers, bases);
		} finally {
			matchers.length = 0;
			bases.length = 0;
		}
	}

	/** Whether `path.slice(0, end)` is ignored, given its ancestors aren't */
	private isLevelIgnored(path: string, end: number, matchers: readonly Ignore[], bases: readonly number[]): boolean {
		for (let i = matchers.length - 1; i >= 0; i--) {
			const verdict = this.testLevel(matchers[i], path.slice(bases[i], end));
			if (verdict != null) return verdict;
		}

		return this.testLevel(this.ig, path.slice(0, end)) ?? false;
	}

	/** Returns the matcher's decisive verdict for `path`, or undefined when it has none */
	private testLevel(matcher: Ignore, path: string): boolean | undefined {
		const result = matcher.test(path);
		if (result.unignored) return false;
		if (!result.ignored) return undefined;

		// `ignore` folds its own verdict for each ancestor into a path's result: once the matcher considers a parent
		// ignored, every child reports that parent's result. Reaching here means a deeper matcher re-included that
		// parent, so this result says nothing about the path itself — the matcher's own rules are unknowable, so
		// answer "not ignored" rather than risk dropping a real change.
		const parentEnd = path.lastIndexOf('/', path.length - 2);
		if (parentEnd !== -1 && matcher.test(path.slice(0, parentEnd + 1)).ignored) return false;

		return true;
	}

	private async loadPatterns(): Promise<void> {
		const id = this._generation.next();

		const [globalResult, infoResult, rootResult, nestedResult, ignoreCaseResult] = await Promise.allSettled([
			this.readGlobalExcludes(),
			this.readInfoExclude(),
			this.readFile(`${this.repoPath}/.gitignore`),
			this.loadNested(),
			this.readIgnoreCase(),
		]);

		// Only commit results if no newer refresh has started
		if (id !== this._generation.current) return;

		const options = { ignorecase: getSettledValue(ignoreCaseResult) ?? defaultIgnoreCase };

		// Added in git's precedence order (lowest first), since the last matching pattern wins
		const ig = ignore(options);
		for (const content of [
			getSettledValue(globalResult),
			getSettledValue(infoResult),
			getSettledValue(rootResult),
		]) {
			if (!content) continue;

			try {
				ig.add(content);
			} catch {
				// A source `ignore` can't parse is skipped rather than failing the whole load
			}
		}

		let nested: Map<string, Ignore> | undefined;
		const nestedContents = getSettledValue(nestedResult);
		if (nestedContents?.size) {
			nested = new Map();
			for (const [dir, content] of nestedContents) {
				try {
					nested.set(dir, ignore(options).add(content));
				} catch {
					// A file `ignore` can't parse is skipped rather than failing the whole load
				}
			}
		}

		this.ig = ig;
		this.nested = nested?.size ? nested : undefined;
	}

	/** Reads every nested `.gitignore`, keyed by its repo-relative directory (no trailing slash) */
	private async loadNested(): Promise<Map<string, string> | undefined> {
		if (this.getGitIgnorePaths == null) return undefined;

		let paths: readonly string[];
		try {
			paths = await this.getGitIgnorePaths();
		} catch {
			// Discovery failed — fall back to the root `.gitignore` alone
			return undefined;
		}

		const suffix = '/.gitignore';
		const dirs = new Set<string>();
		for (const path of paths) {
			// The root `.gitignore` (no directory) is loaded with the other root sources
			if (path.length <= suffix.length || !path.endsWith(suffix)) continue;

			dirs.add(path.slice(0, -suffix.length));
		}
		if (!dirs.size) return undefined;

		const entries = await Promise.allSettled(
			Array.from(dirs, async dir => {
				const content = await this.readFile(`${this.repoPath}/${dir}${suffix}`);
				return content ? ([dir, content] as const) : undefined;
			}),
		);

		const nested = new Map<string, string>();
		for (const entry of entries) {
			const value = getSettledValue(entry);
			if (value != null) {
				nested.set(value[0], value[1]);
			}
		}
		return nested;
	}

	private async readFile(path: string): Promise<string | undefined> {
		try {
			const data = await this.fs.readFile(fileUri(path));
			return new TextDecoder().decode(data);
		} catch {
			// File might not exist or be unreadable — that's fine
			return undefined;
		}
	}

	private async readInfoExclude(): Promise<string | undefined> {
		if (this.getInfoExcludePath == null) return this.readFile(`${this.gitDirPath}/info/exclude`);

		try {
			const path = await this.getInfoExcludePath();
			return path != null ? await this.readFile(path) : undefined;
		} catch {
			// The git dir couldn't be resolved
			return undefined;
		}
	}

	private async readIgnoreCase(): Promise<boolean | undefined> {
		if (this.getIgnoreCase == null) return undefined;

		try {
			return await this.getIgnoreCase();
		} catch {
			// Unreadable — the platform default applies
			return undefined;
		}
	}

	private async readGlobalExcludes(): Promise<string | undefined> {
		if (this.getGlobalExcludesPath == null) return undefined;

		try {
			const path = await this.getGlobalExcludesPath();
			return path != null ? await this.readFile(path) : undefined;
		} catch {
			// Global excludes might not be configured
			return undefined;
		}
	}
}
