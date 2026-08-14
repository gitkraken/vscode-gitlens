import { promises as fs } from 'fs';
import { hostname, userInfo } from 'os';
import { env as process_env } from 'process';
import type { Cache, GkConfigInvalidationTarget, GkReconcileOutcome } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { WorkspaceUntrustedError } from '@gitlens/git/errors.js';
import type { GitDir } from '@gitlens/git/models/repository.js';
import type { SigningConfig, SigningFormat, ValidationResult } from '@gitlens/git/models/signature.js';
import type { GitUser } from '@gitlens/git/models/user.js';
import type {
	DeprecatedGkConfigKeys,
	GitConfigKeys,
	GitConfigSubProvider,
	GitConfigType,
	GkConfigKeys,
} from '@gitlens/git/providers/config.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { first, some } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { dirname, getBestPath, isAbsolute, joinPaths, normalizePath } from '@gitlens/utils/path.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import { fsExists } from '../exec/exec.js';
import type { Git } from '../exec/git.js';

const mappedAuthorRegex = /(.+)\s<(.+)>/;
const emptyArray: readonly never[] = Object.freeze([]);

/** Catch-all pattern matching every key in `.git/gk/config` for the one-shot bulk read. */
const gkConfigAllPattern = '.';

/**
 * Canonicalizes a git config key for lookup against `--get-regexp` output, which git emits with the
 * section and variable-name lowercased and only the subsection case-preserved. Without this a
 * subsection-less key like `gk.defaultRemote` would miss the lowercased `gk.defaultremote` in the map.
 */
export function canonicalizeGitConfigKey(key: string): string {
	const first = key.indexOf('.');
	if (first === -1) return key.toLowerCase();

	const last = key.lastIndexOf('.');
	// `section.name` (no subsection) → fully lowercased; `section.subsection.name` → lowercase
	// section + name, preserve the case-sensitive subsection in the middle.
	if (first === last) return key.toLowerCase();
	return `${key.slice(0, first).toLowerCase()}${key.slice(first, last)}${key.slice(last).toLowerCase()}`;
}

/**
 * Parses git config --get-regex output into a Map.
 * The output format is "key value" per line, where key and value are space-separated.
 *
 * A line with NO space at all is git's rendering of a bareword/valueless entry (`key`, no `=`) — git's
 * OWN config parser reads that as boolean TRUE (git-config(1): "a variable defined without `= <value>`
 * is taken as true"), confirmed against git's `format_config` (builtin/config.c): the key-delimiter is
 * appended unconditionally, then backed out ONLY when the stored value is NULL (the bareword case) —
 * an explicit empty value (`key =`) is a real, non-NULL empty string, so its line KEEPS the trailing
 * space and is already handled by the branch below, byte-distinct from a bareword line.
 *
 * By default a bareword line is skipped (the historical behavior, which reads as "unset" — wrong, but
 * safe); pass `includeValueless` to map it to the literal string `'true'` instead, so `parseGitBoolean`
 * and callers checking `.has()` for "configured" both read it correctly.
 */
export function parseConfigRegexOutput(
	data: string | undefined,
	options?: { includeValueless?: boolean },
): Map<string, string> {
	const configMap = new Map<string, string>();
	if (!data) return configMap;

	for (const line of data.split('\n')) {
		if (!line) continue;

		const spaceIndex = line.indexOf(' ');
		if (spaceIndex === -1) {
			if (options?.includeValueless) {
				configMap.set(line, 'true');
			}
			continue;
		}

		configMap.set(line.substring(0, spaceIndex), line.substring(spaceIndex + 1));
	}

	return configMap;
}

export function parseGitBoolean(value: string | undefined): boolean {
	if (value == null) return false;

	const normalized = value.toLowerCase().trim();
	return normalized === 'true' || normalized === 'yes' || normalized === 'on' || normalized === '1';
}

/** Whether a git config value spells boolean-false (`false`/`no`/`off`/`0`/empty), per git's maybe-bool parsing. */
export function isGitBooleanFalse(value: string): boolean {
	const normalized = value.toLowerCase().trim();
	return (
		normalized === '' || normalized === 'false' || normalized === 'no' || normalized === 'off' || normalized === '0'
	);
}

export class ConfigGitSubProvider implements GitConfigSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {
		this.cache.setGkConfigReconciler((repoPath, priorSnapshot) => this.reconcileGkConfig(repoPath, priorSnapshot));
	}

	/**
	 * In-flight gk-config reconciles keyed by commonPath. `pending` records that another `'gkConfig'`
	 * event landed mid-pass, so one trailing pass runs after the current one settles. `paths` holds every
	 * worktree path that reported the change, mapped to its close generation at that moment — the pass
	 * reads through one that's still open and notifies all of them.
	 */
	private readonly _gkConfigReconciles = new Map<string, { pending: boolean; paths: Map<string, number> }>();

	/**
	 * Pending `setGkConfig` writes keyed by `(commonPath, key, value, skip-option)`. Concurrent
	 * callers writing the same `(key, value)` pair share the in-flight Promise so only one
	 * `git config --set` subprocess actually runs. Cleared on settle.
	 */
	private readonly _pendingGkConfigWrites = new Map<string, Promise<void>>();

	@trace()
	getConfig(
		repoPath: string | undefined,
		key: GitConfigKeys,
		options?: { global?: boolean; runGitLocally?: boolean; type?: GitConfigType },
	): Promise<string | undefined> {
		const global = options?.global || repoPath == null;
		return this.cache.getConfig(global ? undefined : repoPath, key, () =>
			this.getConfigCore(repoPath, key, options),
		);
	}

	private async getConfigCore(
		repoPath: string | undefined,
		key: string,
		options?: { file?: string; global?: boolean; runGitLocally?: boolean; type?: GitConfigType },
	): Promise<string | undefined> {
		const args = ['config', '--get'];
		if (options?.file) {
			args.push('-f', options.file);
		} else if (options?.global || repoPath == null) {
			args.push('--global');
		}
		if (options?.type) {
			args.push(`--type=${options.type}`);
		}
		args.push(key);

		const result = await this.git.run(
			{ cwd: repoPath ?? '', errors: 'ignore', runLocally: options?.runGitLocally },
			...args,
		);
		return result.stdout.trim() || undefined;
	}

	@trace()
	getConfigRegex(
		repoPath: string | undefined,
		pattern: string,
		options?: { global?: boolean; runGitLocally?: boolean },
	): Promise<Map<string, string>> {
		const global = options?.global || repoPath == null;
		return this.cache.getConfigRegex(global ? undefined : repoPath, pattern, () =>
			this.getConfigRegexCore(repoPath, pattern, options),
		);
	}

	private async getConfigRegexCore(
		repoPath: string | undefined,
		pattern: string,
		options?: { file?: string; global?: boolean; runGitLocally?: boolean },
	): Promise<Map<string, string>> {
		const args = ['config', '--get-regex'];
		if (options?.file) {
			args.push('-f', options.file);
		} else if (options?.global || repoPath == null) {
			args.push('--global');
		}
		args.push(pattern);

		const result = await this.git.run(
			{ cwd: repoPath ?? '', errors: 'ignore', runLocally: options?.runGitLocally },
			...args,
		);
		// Deliberately NOT `.trim()`-ed: an explicit-empty value's LAST line ends in a meaningful trailing
		// space, and `.trim()`-ing the whole (possibly multi-line) buffer strips it — `parseConfigRegexOutput`
		// already skips the blank line a trailing newline produces, so no trim is needed.
		return parseConfigRegexOutput(result.stdout);
	}

	@debug()
	async setConfig(
		repoPath: string | undefined,
		key: GitConfigKeys,
		value: string | undefined,
		options?: { file?: string; global?: boolean },
	): Promise<void> {
		return this.setConfigCore(repoPath, key, value, options);
	}

	private async setConfigCore(
		repoPath: string | undefined,
		key: string,
		value: string | undefined,
		options?: { file?: string; global?: boolean },
	): Promise<void> {
		const args: string[] = ['config'];

		if (options?.file) {
			args.push('-f', options.file);
		} else {
			const global = options?.global || repoPath == null;
			args.push(global ? '--global' : '--local');
		}

		if (value == null) {
			args.push('--unset', key);
		} else {
			args.push(key, value);
		}

		await this.git.run({ cwd: repoPath ?? '', runLocally: true }, ...args);

		// Only invalidate cache when not using a custom file (custom files aren't cached)
		if (!options?.file) {
			const global = options?.global || repoPath == null;
			// Invalidate the cached value for this key and clear all regex patterns for this scope
			this.cache.deleteConfig(global ? undefined : repoPath, key);
		}
	}

	@gate()
	@debug()
	async getCurrentUser(repoPath: string): Promise<GitUser | undefined> {
		if (!repoPath) return undefined;

		const scope = getScopedLogger();

		const cached = this.cache.currentUser.get(repoPath);
		if (cached != null) return cached;
		// If we found null, user data was not found - don't bother trying again
		if (cached === null) return undefined;

		const user: GitUser = { name: undefined, email: undefined };

		try {
			const configMap = await this.getConfigRegex(repoPath, '^user\\.(name|email)$', {
				runGitLocally: true,
			});
			if (configMap.size) {
				user.name = configMap.get('user.name');
				user.email = configMap.get('user.email');
			} else {
				user.name =
					process_env.GIT_AUTHOR_NAME || process_env.GIT_COMMITTER_NAME || userInfo()?.username || undefined;
				if (!user.name) {
					// If we found no user data, mark it so we won't bother trying again
					this.cache.currentUser.set(repoPath, null);
					return undefined;
				}

				user.email =
					process_env.GIT_AUTHOR_EMAIL ||
					process_env.GIT_COMMITTER_EMAIL ||
					process_env.EMAIL ||
					`${user.name}@${hostname()}`;
			}

			const author = `${user.name} <${user.email}>`;
			// Check if there is a mailmap for the current user
			const result = await this.git.run({ cwd: repoPath, errors: 'ignore' }, 'check-mailmap', author);

			if (result.stdout && result.stdout !== author) {
				const match = mappedAuthorRegex.exec(result.stdout);
				if (match != null) {
					[, user.name, user.email] = match;
				}
			}

			this.cache.currentUser.set(repoPath, user);
			return user;
		} catch (ex) {
			scope?.error(ex);

			// Mark it so we won't bother trying again
			this.cache.currentUser.set(repoPath, null);
			return undefined;
		}
	}

	@gate()
	@trace({ exit: r => `returned ${r}` })
	async getDefaultWorktreePath(repoPath: string): Promise<string | undefined> {
		const gitDir = await this.getGitDir(repoPath);
		if (gitDir == null) return undefined;

		const basePath = (gitDir.commonUri ?? gitDir.uri).fsPath;
		return getBestPath(normalizePath(joinPaths(basePath, '..')));
	}

	@gate()
	@trace({
		exit: r =>
			`returned ${r.uri.toString(true)}, commonUri=${r.commonUri?.toString(true)}, parentUri=${r.parentUri?.toString(true)}`,
	})
	async getGitDir(repoPath: string): Promise<GitDir> {
		const cached = this.cache.gitDir.get(repoPath);
		if (cached != null) return cached;

		const scope = getScopedLogger();
		const repoInfo = await this.getRepositoryInfo(repoPath);

		let gitDir: GitDir;
		if (!Array.isArray(repoInfo) && repoInfo != null) {
			gitDir = {
				uri: fileUri(repoInfo.gitDir),
				commonUri: repoInfo.commonGitDir ? fileUri(repoInfo.commonGitDir) : undefined,
				parentUri: repoInfo.superprojectPath ? fileUri(repoInfo.superprojectPath) : undefined,
			};
		} else {
			gitDir = {
				uri: this.provider.getAbsoluteUri(joinPaths(repoPath, '.git'), repoPath),
			};

			const gitDirPath = gitDir.uri.toString(true);
			scope?.warn(`rev-parse failed for '${repoPath}'; falling back to '${gitDirPath}'`);
			this.context.hooks?.operations?.onGitDirResolveFailed?.(
				repoPath,
				gitDirPath,
				`rev_parse returned ${JSON.stringify(repoInfo)}`,
			);
		}
		this.cache.gitDir.set(repoPath, gitDir);

		return gitDir;
	}

	/**
	 * Gets the path to the .git/gk/config file for storing GitKraken-specific metadata.
	 * Uses commonPath for worktrees so all worktrees share the same data.
	 */
	private async getGkConfigPath(repoPath: string): Promise<string | undefined> {
		const gitDir = await this.getGitDir(repoPath);
		if (gitDir == null) return undefined;

		// Use commonUri (main .git dir) for worktrees, otherwise use uri
		const basePath = (gitDir.commonUri ?? gitDir.uri).fsPath;
		return joinPaths(basePath, 'gk', 'config');
	}

	@debug()
	async getGkConfig(repoPath: string, key: GkConfigKeys | DeprecatedGkConfigKeys): Promise<string | undefined> {
		// Served in-memory from a single bulk read of the whole `.git/gk/config` (no gk read needs `--type`).
		// Canonicalize the key the way git does for `--get-regexp` output so subsection-less keys
		// (e.g. `gk.defaultRemote`) match, and coerce an empty value to undefined to match the old
		// `git config --get` (`.trim() || undefined`) contract.
		return (await this.getGkConfigMap(repoPath)).get(canonicalizeGitConfigKey(key)) || undefined;
	}

	@debug()
	async getGkConfigRegex(repoPath: string, pattern: string): Promise<Map<string, string>> {
		const all = await this.getGkConfigMap(repoPath);

		// Filter the bulk map in-memory. The old path passed `pattern` to `git config --get-regex`
		// (errors ignored → empty result on a bad pattern); preserve that no-throw contract here
		// rather than letting an invalid-JS pattern reject the read.
		let re: RegExp;
		try {
			re = new RegExp(pattern);
		} catch {
			return new Map();
		}

		const result = new Map<string, string>();
		for (const [k, v] of all) {
			if (re.test(k)) {
				result.set(k, v);
			}
		}
		return result;
	}

	/**
	 * Reads the entire `.git/gk/config` in one `git config --get-regexp` and caches the parsed map
	 * per commonPath. Per-key (getGkConfig) and per-namespace (getGkConfigRegex) lookups are served
	 * from this single cached read — so a branch-overview render that fans out across several gk
	 * namespaces costs one `git config` call instead of one per namespace.
	 */
	private async getGkConfigMap(repoPath: string): Promise<Map<string, string>> {
		// Migrate BEFORE populating the cache, not inside the factory: a first-time migration calls
		// clearCaches('gkConfig'), which would otherwise evict the in-flight gkConfigMap entry the
		// cache wrapper synchronously stored and force a redundant bulk re-read.
		await this.migrateGkConfigFromGitConfig(this.cache.getCommonPath(repoPath));
		return this.cache.getGkConfigMap(repoPath, async cacheable => {
			const { map, failed } = await this.getGkConfigRegexCore(repoPath, gkConfigAllPattern);
			// This map has no TTL and everything gk-related reads through it, so a failed read cached as an
			// empty map would report every branch as having no stored base or merge target for the session —
			// and would make the section-cleanup pre-checks skip real work. Only cache a read that happened.
			if (failed) {
				cacheable.invalidate();
			}
			return map;
		});
	}

	private async getGkConfigRegexCore(
		repoPath: string,
		pattern: string,
	): Promise<{ map: Map<string, string>; failed: boolean }> {
		const gkConfigPath = await this.getGkConfigPath(repoPath);
		// No `.git/gk/config` yet is a real answer, not a failure — a repo GitLens has never written to.
		if (!gkConfigPath) return { map: new Map(), failed: false };

		const result = await this.git.run(
			{ cwd: repoPath, errors: 'ignore', runLocally: true },
			'config',
			'--get-regex',
			'-f',
			gkConfigPath,
			pattern,
		);
		// `--get-regex` exits 1 when nothing matches, which IS an answer (an empty gk config).
		const exited = result.completion.status === 'exited';
		return {
			// Deliberately NOT `.trim()`-ed — see `getConfigRegexCore`'s comment: it strips the trailing
			// space that marks an explicit-empty value's LAST line, silently dropping it from the map.
			map: parseConfigRegexOutput(result.stdout),
			failed: !exited || (result.exitCode !== 0 && result.exitCode !== 1),
		};
	}

	@debug()
	async setGkConfig(
		repoPath: string,
		key: GkConfigKeys | DeprecatedGkConfigKeys,
		value: string | undefined,
		options?: { skipInvalidation?: readonly GkConfigInvalidationTarget[] },
	): Promise<void> {
		// Encode the skip-invalidation option in the dedup key: a self-write (with skip targets)
		// and a user-driven write of the same `(key, value)` (no skip targets) have different
		// cache-invalidation semantics, so sharing their Promise would silently let the user-driven
		// write skip invalidation. Sort the array so callers passing the same targets in different
		// orders share a single in-flight write.
		const commonPath = this.cache.getCommonPath(repoPath);
		const skipKey = options?.skipInvalidation?.length ? options.skipInvalidation.toSorted().join(',') : '';
		const dedupKey = `${commonPath}\0${key}\0${value ?? ''}\0${skipKey}`;

		const pending = this._pendingGkConfigWrites.get(dedupKey);
		if (pending != null) return pending;

		const promise = this.setGkConfigCore(repoPath, key, value, options);
		this._pendingGkConfigWrites.set(dedupKey, promise);
		// Swallow the cleanup chain's rejection so a failed write doesn't surface as an unhandled
		// rejection separate from the caller's own handling of the returned promise.
		void promise.finally(() => this._pendingGkConfigWrites.delete(dedupKey)).catch(() => {});
		return promise;
	}

	private async setGkConfigCore(
		repoPath: string,
		key: GkConfigKeys | DeprecatedGkConfigKeys,
		value: string | undefined,
		options?: { skipInvalidation?: readonly GkConfigInvalidationTarget[] },
	): Promise<void> {
		const scope = getScopedLogger();

		const gkConfigPath = await this.getGkConfigPath(repoPath);
		if (!gkConfigPath) return;

		const gkConfigFolder = joinPaths(gkConfigPath, '..');

		if (!(await this.ensureGkConfigFolder(gkConfigFolder, scope))) return;

		await this.setConfigCore(repoPath, key, value, { file: gkConfigPath });

		// Invalidate the bulk map (so the next read re-fetches) and the derived caches for this key's
		// ref. The `.git/gk/config` file-watcher also fires `'gkConfig'` shortly after, which reconciles
		// the same change (see `reconcileGkConfig`) — recording our own write here keeps that later
		// reconcile from re-diffing this key as an external change.
		this.cache.deleteGkConfig(repoPath, key, options);
		this.cache.recordGkConfigWrite(repoPath, key, value);
	}

	@debug()
	async removeGkConfigBranchSection(repoPath: string, ref: string): Promise<void> {
		await this.runGkConfigSectionCommand(repoPath, ref, '--remove-section', `branch.${ref}`);
	}

	@debug()
	async renameGkConfigBranchSection(repoPath: string, oldRef: string, newRef: string): Promise<void> {
		// Clear the destination first, unconditionally. `--rename-section` onto a section that already
		// exists APPENDS rather than replaces, leaving duplicate keys — and git resolves a duplicated key
		// to its LAST value, so the orphan left by an earlier branch of this name would win over the
		// metadata being moved. Doing this outside `runGkConfigSectionCommand` also covers the case where
		// the source has no gk keys at all, where its pre-check would otherwise skip the whole call and
		// leave the orphan in place for the renamed branch to inherit.
		await this.removeGkConfigBranchSection(repoPath, newRef);
		await this.runGkConfigSectionCommand(
			repoPath,
			oldRef,
			'--rename-section',
			`branch.${oldRef}`,
			`branch.${newRef}`,
		);
	}

	/**
	 * Runs a section-level `git config` against `.git/gk/config` for `ref`'s section, skipping the
	 * subprocess entirely when the bulk map (already cached on any warm path) shows that ref has no gk
	 * keys — the overwhelmingly common case, since most branches never get gk metadata written at all.
	 *
	 * Never throws: callers invoke this as bookkeeping after a branch op has already succeeded, so a
	 * failure here must not be reported as (or roll back) the branch/checkout/worktree operation itself.
	 * The worst case is metadata that stays behind until the next op on that name.
	 */
	private async runGkConfigSectionCommand(repoPath: string, ref: string, ...args: string[]): Promise<void> {
		const scope = getScopedLogger();
		try {
			const prefix = `branch.${ref}.`;
			const map = await this.getGkConfigMap(repoPath);
			// The shortcut needs a map with CONTENT to be trustworthy. A failed bulk read resolves empty
			// (see `getGkConfigMap`) — the cache refuses it, but this caller still holds it — and an empty map
			// read as authoritative would skip the removal entirely, leaving a deleted branch's base,
			// disposition and issue links behind for the next branch reusing that name. When it's empty, run
			// the command: worst case is a no-op on a section that isn't there.
			if (map.size && !some(map.keys(), k => k.startsWith(prefix))) return;

			const gkConfigPath = await this.getGkConfigPath(repoPath);
			if (!gkConfigPath) return;
			// `getGkConfigPath` only joins a path, so check the file: with no `.git/gk/config` there is
			// genuinely nothing to remove, and running the command would fail with a fatal we'd then warn
			// about on every branch delete in a repo that has never had gk metadata.
			if (!(await fsExists(gkConfigPath))) return;

			const result = await this.git.run(
				{ cwd: repoPath, runLocally: true, errors: 'ignore' },
				'config',
				'-f',
				gkConfigPath,
				...args,
			);
			// `errors: 'ignore'` is deliberate — see the note above on why this must never throw — but that
			// also means the `catch` below never sees a failed write, so without this the metadata silently
			// stays behind (or, on a rename, stays under the old name) with nothing recorded anywhere.
			// Reported, not thrown: the branch op it follows has already succeeded.
			if (result.completion.status !== 'exited' || result.exitCode !== 0) {
				scope?.warn(
					`Failed to update gk config section for '${ref}' in '${repoPath}': ${
						result.completion.status === 'exited'
							? `git config exited ${result.exitCode}`
							: `${result.completion.status} · ${result.completion.error.message}`
					}`,
				);
			}
			// A whole section moved or vanished, which the per-key `deleteGkConfig` cascade can't express.
			// Drop the bulk map so the next read hits disk; the derived caches for the affected ref are
			// evicted by the caller's own `deleteBaseBranchName` plus the `'branches'` cascade it fires.
			this.cache.deleteGkConfigMap(repoPath);
		} catch (ex) {
			scope?.error(ex, `Failed to update gk config section for '${ref}' in '${repoPath}'`);
		}
	}

	/**
	 * Reconciles a watcher-observed `'gkConfig'` change — registered with the shared `Cache` as its
	 * gk-config reconciler (see the constructor). Re-reads the bulk map (hard-evicted by
	 * `Cache.handleGkConfigChanged`, so this hits disk) and diffs it against `priorSnapshot` to cascade
	 * `baseBranchName`/`branchOverviews` only for refs whose merge-relevant keys actually changed.
	 *
	 * Serialized per commonPath: a reconcile is a read-then-diff against a single shared baseline, so
	 * two overlapping passes would both diff against the same snapshot and the later change could fall
	 * out entirely. An event arriving mid-pass instead queues one trailing pass, which re-reads and
	 * diffs against the baseline the previous pass just established.
	 *
	 * `.git/gk/config` lives in the common dir, so the watcher delivers one event per worktree sharing it
	 * (see `WatchGroup.onCommonEvent`). Siblings never run concurrently — the later ones fold into the
	 * in-flight pass — but folding in arms the trailing pass, so a fan-out costs one extra read that
	 * re-reads and diffs an unchanged file. However many siblings land while a pass is running, they
	 * coalesce into that single trailing pass; the cost is the price of never dropping a real change.
	 * Every reporting path is retained because `Repository` matches the follow-up change event on exact
	 * path, and a sibling worktree that never receives one would sit on stale derived values.
	 */
	private reconcileGkConfig(
		repoPath: string,
		priorSnapshot: ReadonlyMap<string, string> | undefined,
	): GkReconcileOutcome | Promise<GkReconcileOutcome> {
		const commonPath = this.cache.getCommonPath(repoPath);

		const inflight = this._gkConfigReconciles.get(commonPath);
		if (inflight != null) {
			inflight.paths.set(repoPath, this.cache.getCloseGeneration(repoPath));
			inflight.pending = true;
			// Handed to the in-flight pass's trailing loop, so it IS being reconciled — just not by this
			// call. Reporting a failure here would coarse-clear on every write in a burst.
			return 'deferred';
		}

		const entry = { pending: false, paths: new Map([[repoPath, this.cache.getCloseGeneration(repoPath)]]) };
		this._gkConfigReconciles.set(commonPath, entry);
		return this.runGkConfigReconcile(commonPath, priorSnapshot, entry);
	}

	/** Drops paths that closed since they reported the change; returns whichever remain. */
	private pruneClosedReconcilePaths(paths: Map<string, number>): Map<string, number> {
		for (const [path, generation] of paths) {
			if (this.cache.getCloseGeneration(path) !== generation) {
				paths.delete(path);
			}
		}
		return paths;
	}

	private async runGkConfigReconcile(
		commonPath: string,
		priorSnapshot: ReadonlyMap<string, string> | undefined,
		entry: { pending: boolean; paths: Map<string, number> },
	): Promise<GkReconcileOutcome> {
		const scope = getScopedLogger();
		let snapshot = priorSnapshot;

		try {
			do {
				entry.pending = false;

				// Read through a path that's still open — one worktree closing must not drop the event for
				// its still-open siblings, which is why this reads from the surviving set rather than from
				// whichever path happened to report first.
				const readPath = first(this.pruneClosedReconcilePaths(entry.paths).keys());
				// Every path that reported the change has since closed — nothing left to reconcile, and
				// nothing left holding a stale derived value either.
				if (readPath == null) return 'reconciled';

				// A trailing pass must not reuse the entry the pass before it installed.
				this.cache.deleteGkConfigMap(readPath);
				const freshMap = await this.getGkConfigMap(readPath);
				// Paths may have closed while the re-read was in flight; if every one did, there's nothing
				// left to reconcile against.
				if (!this.pruneClosedReconcilePaths(entry.paths).size) return 'reconciled';

				if (this.cache.reconcileGkConfigMap(readPath, snapshot, freshMap)) {
					// Fire a follow-up change: a consumer that re-read on the original event may have done so
					// before this async cascade landed, so it would otherwise hold a stale derived value with
					// nothing left to prompt another re-read.
					for (const path of entry.paths.keys()) {
						this.context.hooks?.repository?.onChanged?.(path, ['gkConfig']);
					}
				}

				// `reconcileGkConfigMap` advanced the stored baseline to what we just read; a trailing pass
				// diffs its own read against that.
				snapshot = this.cache.getGkConfigMergeSnapshot(readPath);
			} while (entry.pending);

			return 'reconciled';
		} catch (ex) {
			scope?.error(ex, `Failed to reconcile gk config for '${commonPath}'`);
			// The caller falls back to the coarse clear — derived caches are otherwise left holding
			// pre-change values with nothing to correct them.
			return 'failed';
		} finally {
			this._gkConfigReconciles.delete(commonPath);
		}
	}

	@debug()
	async getSigningConfig(repoPath: string): Promise<SigningConfig> {
		// Fetch all signing-related config in one call
		const configMap = await this.getConfigRegex(
			repoPath,
			'^(commit\\.gpgsign|gpg\\.format|user\\.signingkey|gpg\\.program|gpg\\.ssh\\.program|gpg\\.ssh\\.allowedsignersfile)$',
		);

		// Extract values (keys are lowercase in git output)
		const enabledRaw = configMap.get('commit.gpgsign');
		const format = configMap.get('gpg.format');
		const signingKey = configMap.get('user.signingkey');
		const gpgProgram = configMap.get('gpg.program');
		const sshProgram = configMap.get('gpg.ssh.program');
		const allowedSignersFile = configMap.get('gpg.ssh.allowedsignersfile');

		// Check if git config has commit signing enabled, falling back to the host-level override
		// (e.g. VS Code's `git.enableCommitSigning`) when `commit.gpgsign` is unset/false. The host
		// override can only enable signing, never force it off.
		const isEnabled = parseGitBoolean(enabledRaw) || this.context.config?.signing?.enabled === true;

		return {
			enabled: isEnabled,
			format: (format as SigningFormat) ?? 'gpg',
			signingKey: signingKey,
			gpgProgram: gpgProgram,
			sshProgram: sshProgram,
			allowedSignersFile: allowedSignersFile,
		};
	}

	@debug()
	async validateSigningSetup(repoPath: string): Promise<ValidationResult> {
		const config = await this.getSigningConfig(repoPath);

		if (!config.signingKey) {
			return { valid: false, error: 'No signing key configured' };
		}

		// Basic validation: just check that a signing key is configured
		// Git will handle the actual validation when signing commits
		return { valid: true };
	}

	@debug()
	async setSigningConfig(
		repoPath: string,
		config: Partial<SigningConfig>,
		options?: { global?: boolean },
	): Promise<void> {
		const scope = getScopedLogger();

		try {
			if (config.enabled != null) {
				await this.setConfig(repoPath, 'commit.gpgsign', config.enabled ? 'true' : 'false', options);
			}
			if (config.format != null) {
				await this.setConfig(repoPath, 'gpg.format', config.format, options);
			}
			if (config.signingKey != null) {
				await this.setConfig(repoPath, 'user.signingkey', config.signingKey, options);
			}
			if (config.gpgProgram != null) {
				await this.setConfig(repoPath, 'gpg.program', config.gpgProgram, options);
			}
			if (config.sshProgram != null) {
				await this.setConfig(repoPath, 'gpg.ssh.program', config.sshProgram, options);
			}
			if (config.allowedSignersFile != null) {
				await this.setConfig(repoPath, 'gpg.ssh.allowedSignersFile', config.allowedSignersFile, options);
			}
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	getSigningConfigFlags(config: SigningConfig): string[] {
		const flags: string[] = [];

		if (config.gpgProgram) {
			flags.push('-c', `gpg.program=${config.gpgProgram}`);
		}
		if (config.format && config.format !== 'gpg') {
			flags.push('-c', `gpg.format=${config.format}`);
		}
		if (config.sshProgram) {
			flags.push('-c', `gpg.ssh.program=${config.sshProgram}`);
		}
		if (config.allowedSignersFile) {
			flags.push('-c', `gpg.ssh.allowedSignersFile=${config.allowedSignersFile}`);
		}

		return flags;
	}

	async getRepositoryInfo(
		cwd: string,
	): Promise<
		| { repoPath: string; gitDir: string; commonGitDir: string | undefined; superprojectPath: string | undefined }
		| [safe: true, repoPath: string]
		| [safe: false]
		| []
	> {
		let result;

		if (this.context.workspace?.isTrusted === false) {
			try {
				await fs.stat(joinPaths(cwd, 'HEAD'));
				result = await this.git.run(
					{ cwd: cwd, errors: 'throw', configs: ['-C', cwd] },
					'rev-parse',
					'--show-cdup',
				);
				if (!result.stdout.trim()) {
					Logger.warn(`Skipping (untrusted); bare clone repository detected in '${cwd}'`);
					return emptyArray as [];
				}
			} catch {
				// If this throws, we should be good to open the repo
			}
		}

		try {
			result = await this.git.run(
				{ cwd: cwd, errors: 'throw' },
				'rev-parse',
				'--show-toplevel',
				'--git-dir',
				'--git-common-dir',
				'--show-superproject-working-tree',
			);
			if (!result.stdout) return emptyArray as [];

			// Output is 3-4 lines: show-toplevel, git-dir, git-common-dir, [show-superproject-working-tree]
			// The 4th line is only present for submodules
			const lines = result.stdout.split('\n').map(r => r.trimStart());
			const [repoPath, dotGitPath, commonDotGitPath, superprojectPath] = lines;

			if (!repoPath) return emptyArray as [];

			const normalizedRepoPath = normalizePath(repoPath.replace(/[\r|\n]+$/, ''));

			let gitDir = dotGitPath;
			if (gitDir && !isAbsolute(gitDir)) {
				gitDir = joinPaths(cwd, gitDir);
			}
			gitDir = normalizePath(gitDir);

			let commonGitDir: string | undefined;
			if (commonDotGitPath) {
				commonGitDir = commonDotGitPath;
				if (!isAbsolute(commonGitDir)) {
					commonGitDir = joinPaths(cwd, commonGitDir);
				}
				commonGitDir = normalizePath(commonGitDir);
				if (commonGitDir === gitDir) {
					commonGitDir = undefined;
				}
			}

			return {
				repoPath: normalizedRepoPath,
				gitDir: gitDir,
				commonGitDir: commonGitDir,
				superprojectPath: superprojectPath?.trim() || undefined,
			};
		} catch (ex: any) {
			if (ex instanceof WorkspaceUntrustedError) return emptyArray as [];

			const unsafeMatch =
				/(?:^fatal:\s*detected dubious ownership in repository at '([^']+)'|unsafe repository \('([^']+)' is owned by someone else\))[\s\S]*(git config --global --add safe\.directory [^\n\u2022]+)/m.exec(
					ex.stderr,
				);
			if (unsafeMatch != null) {
				Logger.warn(
					`Skipping; unsafe repository detected in '${unsafeMatch[1] || unsafeMatch[2]}'; run '${
						unsafeMatch[3]
					}' to allow it`,
				);
				return [false];
			}

			const inDotGit = /this operation must be run in a work tree/.test(ex.stderr);
			if (inDotGit && this.context.workspace?.isTrusted !== false) {
				result = await this.git.run({ cwd: cwd, errors: 'ignore' }, 'rev-parse', '--is-bare-repository');
				if (result.stdout.trim() === 'true') {
					const result = await this.revParseGitDir(cwd);
					const repoPath = result?.commonPath ?? result?.path;
					if (repoPath?.length) return [true, repoPath];
				}
			}

			if (inDotGit || ex.code === 'ENOENT') {
				let exists = inDotGit ? false : await fsExists(cwd);
				if (!exists) {
					do {
						const parent = dirname(cwd);
						if (parent === cwd || parent.length === 0) return emptyArray as [];

						cwd = parent;
						exists = await fsExists(cwd);
					} while (!exists);

					return this.getRepositoryInfo(cwd);
				}
			}
			return emptyArray as [];
		}
	}

	private async revParseGitDir(cwd: string): Promise<{ path: string; commonPath?: string } | undefined> {
		const result = await this.git.run({ cwd: cwd, errors: 'ignore' }, 'rev-parse', '--git-dir', '--git-common-dir');
		if (!result.stdout) return undefined;

		let [dotGitPath, commonDotGitPath] = result.stdout.split('\n').map(r => r.trimStart());

		if (!isAbsolute(dotGitPath)) {
			dotGitPath = joinPaths(cwd, dotGitPath);
		}
		dotGitPath = normalizePath(dotGitPath);

		if (commonDotGitPath) {
			if (!isAbsolute(commonDotGitPath)) {
				commonDotGitPath = joinPaths(cwd, commonDotGitPath);
			}
			commonDotGitPath = normalizePath(commonDotGitPath);

			return { path: dotGitPath, commonPath: commonDotGitPath !== dotGitPath ? commonDotGitPath : undefined };
		}

		return { path: dotGitPath };
	}

	/**
	 * Ensures the `.git/gk/` folder exists, but only if the parent `.git` directory already exists.
	 * This prevents creating stray `.git` directories if the computed path is wrong.
	 * Returns `true` if the folder was ensured, `false` if the parent `.git` does not exist.
	 */
	private async ensureGkConfigFolder(
		gkConfigFolder: string,
		scope: ReturnType<typeof getScopedLogger>,
	): Promise<boolean> {
		// Verify the .git directory already exists — never create it from scratch
		const dotGitDir = joinPaths(gkConfigFolder, '..');
		try {
			await fs.stat(dotGitDir);
		} catch {
			scope?.warn(`Skipping GK config write — expected git directory '${dotGitDir}' does not exist`);
			return false;
		}

		try {
			await fs.mkdir(gkConfigFolder, { recursive: true });
		} catch (ex) {
			scope?.error(ex, `Failed to create '${gkConfigFolder}' directory`);
			return false;
		}

		return true;
	}

	private _migratedRepos = new Set<string>();

	/**
	 * One-time migration of GK config entries from regular git config to `.git/gk/config`.
	 * If `.git/gk/config` already exists, assumes migration is complete (or data is already there).
	 * Preserves existing `.git/gk/config` values as source of truth (won't overwrite).
	 * Removes migrated keys from regular git config to stop cluttering it.
	 */
	@gate()
	@debug()
	private async migrateGkConfigFromGitConfig(repoPath: string): Promise<void> {
		if (this._migratedRepos.has(repoPath)) return;

		const scope = getScopedLogger();

		const gkConfigPath = await this.getGkConfigPath(repoPath);
		if (!gkConfigPath) {
			this._migratedRepos.add(repoPath);
			return;
		}

		const gkConfigFolder = joinPaths(gkConfigPath, '..');

		// If .git/gk/config already exists, consider migration done — it was either
		// already migrated or values were written there directly via setGkConfig
		try {
			await fs.stat(gkConfigPath);
			this._migratedRepos.add(repoPath);
			return;
		} catch {
			// file doesn't exist, proceed with migration
		}

		// If .git/gk/config doesn't exist, create an empty file to prevent multiple migration attempts in future sessions
		if (!(await this.ensureGkConfigFolder(gkConfigFolder, scope))) return;

		try {
			await fs.writeFile(gkConfigPath, new Uint8Array());
		} catch (ex) {
			scope?.error(ex, `Failed to create '${gkConfigPath}' file`);
		}

		// Read legacy gk-* keys from regular git config
		let migrateConfig: Map<string, string>;
		try {
			migrateConfig = await this.getConfigRegexCore(repoPath, '^branch\\..*\\.gk-', { runGitLocally: true });
		} catch (ex) {
			scope?.error(ex, 'Failed to read legacy GK config entries');
			this._migratedRepos.add(repoPath);
			return;
		}

		if (!migrateConfig.size) {
			this._migratedRepos.add(repoPath);
			return;
		}

		scope?.info(`Migrating ${String(migrateConfig.size)} GK config entries from git config to .git/gk/config`);

		// Copy legacy entries to .git/gk/config
		for (const [key, value] of [...migrateConfig]) {
			try {
				await this.setConfigCore(repoPath, key, value, { file: gkConfigPath });
			} catch (ex) {
				scope?.error(ex, `Failed to migrate key '${key}' to GK config`);
				// If we failed to migrate, delete it from the list so we won't try to remove it from git config later
				migrateConfig.delete(key);
			}
		}

		// Remove legacy keys from regular git config (use --unset-all defensively)
		for (const [key] of migrateConfig) {
			try {
				await this.git.run(
					{ cwd: repoPath, errors: 'ignore', runLocally: true },
					'config',
					'--local',
					'--unset-all',
					key,
				);
			} catch (ex) {
				scope?.error(ex, `Failed to remove migrated key '${key}' from git config`);
			}
		}

		// Clear caches since we modified both config files
		this.cache.clearCaches(repoPath, 'config', 'gkConfig');

		this._migratedRepos.add(repoPath);
	}
}
